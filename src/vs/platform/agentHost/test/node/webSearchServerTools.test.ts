/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { mock } from '../../../../base/test/common/mock.js';
import type { IRequestOptions } from '../../../../base/parts/request/common/request.js';
import type { IRequestService } from '../../../request/common/request.js';
import { WebSearchServerToolName } from '../../common/serverToolNames.js';
import { ARNI_API_RESOURCE } from '../../common/arniApi.js';
import { AgentHostAuthenticationService } from '../../node/agentHostAuthenticationService.js';
import { IAgent } from '../../common/agent.js';
import { NullLogService } from '../../../log/common/log.js';
import { getServerToolDisplay } from '../../node/shared/serverToolGroups.js';
import { createArniWebSearchAccessor, parseArniWebSearchResponse } from '../../node/shared/arniWebSearch.js';
import { createWebSearchServerToolGroup, formatWebSearchResults, parseWebSearchQuery, type IWebSearchServerToolAccessor } from '../../node/shared/webSearchServerTools.js';

suite('Web Search Server Tool', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const context = { sessionUri: 'copilot:/session', chatUri: 'ahp-chat://copilot/session/chat/default' };

	test('display names the query', () => {
		const display = getServerToolDisplay(WebSearchServerToolName.SearchWeb, { query: 'vscode tests' });
		assert.deepStrictEqual({
			displayName: display?.displayName,
			invocation: display?.invocationMessage,
			past: display?.pastTenseMessage,
		}, {
			displayName: 'Web Search',
			invocation: 'Searching the web for "vscode tests"',
			past: 'Searched the web for "vscode tests"',
		});
	});

	test('formats hits and reports an empty result', () => {
		assert.strictEqual(formatWebSearchResults('vscode', []), 'No web results for "vscode".');
		assert.strictEqual(formatWebSearchResults('vscode', [{
			title: 'Visual Studio Code',
			url: 'https://code.visualstudio.com',
			description: 'Editor\nfor code',
		}]), [
			'Web results for "vscode":',
			'1. Visual Studio Code',
			'   https://code.visualstudio.com',
			'   Editor for code',
		].join('\n'));
	});

	test('accepts only a nonempty query of at most 300 characters', () => {
		assert.throws(() => parseWebSearchQuery({}), /query must be a non-empty string/);
		assert.throws(() => parseWebSearchQuery({ query: 'x'.repeat(301) }), /at most 300/);
		assert.deepStrictEqual(parseWebSearchQuery({ query: ' vscode ', count: 2, country: 'ru', search_lang: 'RU' }), {
			query: 'vscode',
		});
		assert.strictEqual(parseWebSearchQuery({ query: 'x'.repeat(300) }).query.length, 300);
	});

	test('execute returns formatted results and stays hidden without an accessor', async () => {
		const accessor: IWebSearchServerToolAccessor = {
			isEnabled: () => true,
			search: async () => [{ title: 'VS Code', url: 'https://code.visualstudio.com', description: 'Editor' }],
		};
		const enabled = createWebSearchServerToolGroup(accessor);
		const disabled = createWebSearchServerToolGroup();
		assert.strictEqual(enabled.isEnabled(WebSearchServerToolName.SearchWeb), true);
		assert.strictEqual(disabled.isEnabled(WebSearchServerToolName.SearchWeb), false);
		assert.strictEqual(
			await enabled.execute(null as never, context, WebSearchServerToolName.SearchWeb, { query: 'vscode' }),
			[
				'Web results for "vscode":',
				'1. VS Code',
				'   https://code.visualstudio.com',
				'   Editor',
			].join('\n'),
		);
	});

	test('the shared API receives the user token and not a provider key', async () => {
		const requests = new FakeRequestService();
		requests.body = JSON.stringify({
			results: [
				{ title: 'Docs', url: 'https://example.com/docs', snippet: 'Reference' },
				{ title: 'Script', url: 'javascript:alert(1)', snippet: 'nope' },
			],
		});
		const accessor = createArniWebSearchAccessor(requests, () => 'user-jwt');
		const hits = await accessor.search({ query: 'vscode docs' });

		assert.deepStrictEqual(hits, [{ title: 'Docs', url: 'https://example.com/docs', description: 'Reference' }]);
		assert.strictEqual(requests.last?.url, 'https://api.arnion.ru/api/web-search');
		assert.strictEqual(requests.last?.headers?.Authorization, 'Bearer user-jwt');
		assert.strictEqual(requests.last?.data, JSON.stringify({ query: 'vscode docs' }));
		assert.strictEqual(JSON.stringify(requests.last).includes('X-Subscription-Token'), false);
	});

	test('a missing sign-in does not call the API', async () => {
		const requests = new FakeRequestService();
		const accessor = createArniWebSearchAccessor(requests, () => undefined);
		await assert.rejects(() => accessor.search({ query: 'vscode' }), /Arni sign-in/);
		assert.strictEqual(requests.last, undefined);
	});

	test('host authentication feeds the shared tool and revocation prevents another API request', async () => {
		const auth = store.add(new AgentHostAuthenticationService(new NullLogService()));
		const requests = new FakeRequestService();
		requests.body = '{"results":[{"title":"Official docs","url":"https://example.com/docs","snippet":"Reference"}]}';
		const tool = createWebSearchServerToolGroup(createArniWebSearchAccessor(requests, () => auth.getAuthToken({ resource: ARNI_API_RESOURCE })));
		let forwarded = false;
		const modelProvider = new class extends mock<IAgent>() {
			override getProtectedResources() { return []; }
			override async handleAuthenticationToken() { forwarded = true; return true; }
		};
		assert.deepStrictEqual(await auth.authenticate({ resource: ARNI_API_RESOURCE, token: 'arni-jwt' }, [modelProvider]), { authenticated: true });
		await auth.replay(modelProvider);
		assert.strictEqual(forwarded, false);
		const output = await tool.execute(null as never, context, WebSearchServerToolName.SearchWeb, { query: 'official docs' });
		assert.ok(output.includes('https://example.com/docs'));
		assert.strictEqual(requests.last?.headers?.Authorization, 'Bearer arni-jwt');
		await auth.authenticate({ resource: ARNI_API_RESOURCE, token: '' }, []);
		await assert.rejects(() => Promise.resolve(tool.execute(null as never, context, WebSearchServerToolName.SearchWeb, { query: 'official docs' })), /Arni sign-in/);
		assert.strictEqual(requests.calls.length, 1);
	});

	test('an unauthorized response does not include the token', async () => {
		const requests = new FakeRequestService();
		requests.status = 401;
		requests.body = 'user-jwt leaked';
		const accessor = createArniWebSearchAccessor(requests, () => 'user-jwt');
		await assert.rejects(
			() => accessor.search({ query: 'vscode' }),
			(error: Error) => {
				assert.strictEqual(error.message.includes('user-jwt'), false);
				assert.strictEqual(error.message.includes('leaked'), false);
				return true;
			},
		);
	});

	test('parser distinguishes an empty search from a malformed response', () => {
		assert.deepStrictEqual(parseArniWebSearchResponse('{"results":[]}'), []);
		assert.throws(() => parseArniWebSearchResponse('{}'), /invalid response/);
		assert.throws(() => parseArniWebSearchResponse('not-json'), /not JSON/);
	});

	test('only transport failures and 503 try the direct origin', async () => {
		for (const first of [401, 403, 500, 503, 'network'] as const) {
			const requests = new FakeRequestService();
			requests.responses = [first, 200];
			requests.body = '{"results":[]}';
			const accessor = createArniWebSearchAccessor(requests, () => 'user-jwt');
			if (first === 503 || first === 'network') {
				assert.deepStrictEqual(await accessor.search({ query: 'vscode' }), []);
			} else {
				await assert.rejects(() => accessor.search({ query: 'vscode' }));
			}
			assert.deepStrictEqual(requests.calls.map(call => call.url), first === 503 || first === 'network'
				? ['https://api.arnion.ru/api/web-search', 'https://arni-backend.vercel.app/api/web-search']
				: ['https://api.arnion.ru/api/web-search']);
		}
	});

	test('transport errors are sanitized and malformed responses are not retried', async () => {
		const requests = new FakeRequestService();
		requests.responses = ['network', 'network'];
		await assert.rejects(() => createArniWebSearchAccessor(requests, () => 'user-jwt').search({ query: 'docs' }), error => {
			assert.ok(error instanceof Error && !error.message.includes('user-jwt'));
			return true;
		});
		requests.responses = [200];
		requests.calls.length = 0;
		requests.body = 'invalid-json';
		await assert.rejects(() => createArniWebSearchAccessor(requests, () => 'user-jwt').search({ query: 'docs' }), /not JSON/);
		assert.strictEqual(requests.calls.length, 1);
	});

	test('caps valid results at five and rejects non-http URLs', () => {
		const valid = Array.from({ length: 8 }, (_, index) => ({ title: `Result ${index}`, url: `https://example.com/${index}`, snippet: 'text' }));
		const parsed = parseArniWebSearchResponse(JSON.stringify({ results: [{ title: 'Bad', url: 'file:///secret' }, ...valid] }));
		assert.deepStrictEqual(parsed.map(hit => hit.url), valid.slice(0, 5).map(hit => hit.url));
	});
});

class FakeRequestService implements IRequestService {
	declare readonly _serviceBrand: undefined;
	readonly onDidCompleteRequest = Event.None;
	last: IRequestOptions | undefined;
	readonly calls: IRequestOptions[] = [];
	responses: (number | 'network')[] = [];
	status = 200;
	body = '';

	async request(options: IRequestOptions): Promise<{ res: { headers: Record<string, string>; statusCode: number }; stream: ReturnType<typeof bufferToStream> }> {
		this.last = options;
		this.calls.push(options);
		const status = this.responses.shift() ?? this.status;
		if (status === 'network') { throw new Error('Network error with Authorization: Bearer user-jwt'); }
		return {
			res: { headers: {}, statusCode: status },
			stream: bufferToStream(VSBuffer.fromString(this.body)),
		};
	}

	async resolveProxy(): Promise<string | undefined> {
		return undefined;
	}

	async lookupAuthorization(): Promise<undefined> {
		return undefined;
	}

	async lookupKerberosAuthorization(): Promise<undefined> {
		return undefined;
	}

	async loadCertificates(): Promise<string[]> {
		return [];
	}
}

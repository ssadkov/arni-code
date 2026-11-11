/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import type { IRequestOptions } from '../../../../base/parts/request/common/request.js';
import type { IRequestService } from '../../../request/common/request.js';
import { WebSearchServerToolName } from '../../common/serverToolNames.js';
import { getServerToolDisplay } from '../../node/shared/serverToolGroups.js';
import { createArniWebSearchAccessor, parseArniWebSearchResponse } from '../../node/shared/arniWebSearch.js';
import { createWebSearchServerToolGroup, formatWebSearchResults, parseWebSearchQuery, type IWebSearchServerToolAccessor } from '../../node/shared/webSearchServerTools.js';

suite('Web Search Server Tool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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

	test('rejects a missing query and normalizes optional filters', () => {
		assert.throws(() => parseWebSearchQuery({}), /query must be a non-empty string/);
		assert.throws(() => parseWebSearchQuery({ query: 'vscode', count: 11 }), /count must be an integer from 1 to 10/);
		assert.deepStrictEqual(parseWebSearchQuery({ query: ' vscode ', count: 2, country: 'ru', search_lang: 'RU' }), {
			query: 'vscode',
			count: 2,
			country: 'RU',
			searchLang: 'ru',
		});
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
		const hits = await accessor.search({ query: 'vscode docs', count: 5, country: 'RU' });

		assert.deepStrictEqual(hits, [{ title: 'Docs', url: 'https://example.com/docs', description: 'Reference' }]);
		assert.strictEqual(requests.last?.url, 'https://api.arnion.ru/api/web-search');
		assert.strictEqual(requests.last?.headers?.Authorization, 'Bearer user-jwt');
		assert.strictEqual(requests.last?.data, JSON.stringify({ query: 'vscode docs', count: 5, country: 'RU' }));
		assert.strictEqual(JSON.stringify(requests.last).includes('X-Subscription-Token'), false);
	});

	test('a missing sign-in does not call the API', async () => {
		const requests = new FakeRequestService();
		const accessor = createArniWebSearchAccessor(requests, () => undefined);
		await assert.rejects(() => accessor.search({ query: 'vscode', count: 5 }), /Arni sign-in/);
		assert.strictEqual(requests.last, undefined);
	});

	test('an unauthorized response does not include the token', async () => {
		const requests = new FakeRequestService();
		requests.status = 401;
		requests.body = 'user-jwt leaked';
		const accessor = createArniWebSearchAccessor(requests, () => 'user-jwt');
		await assert.rejects(
			() => accessor.search({ query: 'vscode', count: 5 }),
			(error: Error) => {
				assert.strictEqual(error.message.includes('user-jwt'), false);
				assert.strictEqual(error.message.includes('leaked'), false);
				return true;
			},
		);
	});

	test('parser ignores a response without results', () => {
		assert.deepStrictEqual(parseArniWebSearchResponse('{}'), []);
		assert.throws(() => parseArniWebSearchResponse('not-json'), /not JSON/);
	});
});

class FakeRequestService implements IRequestService {
	declare readonly _serviceBrand: undefined;
	readonly onDidCompleteRequest = Event.None;
	last: IRequestOptions | undefined;
	status = 200;
	body = '';

	async request(options: IRequestOptions): Promise<{ res: { headers: Record<string, string>; statusCode: number }; stream: ReturnType<typeof bufferToStream> }> {
		this.last = options;
		return {
			res: { headers: {}, statusCode: this.status },
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

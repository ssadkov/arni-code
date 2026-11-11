/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import type { IRequestOptions } from '../../../../base/parts/request/common/request.js';
import type { IRequestService } from '../../../request/common/request.js';
import { ImageServerToolName } from '../../common/serverToolNames.js';
import { getServerToolDisplay } from '../../node/shared/serverToolGroups.js';
import { createArniImageAccessor, isPng, parseGenerationResponse } from '../../node/shared/arniImageGeneration.js';
import { createImageServerToolGroup, imageRequestKey, imageTarget, parseImageRequest, type IImageServerToolAccessor } from '../../node/shared/imageServerTools.js';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(0)]);

suite('Image Server Tool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let root: string;
	setup(async () => {
		root = await fs.mkdtemp(join(tmpdir(), 'arni-image-tool-'));
	});
	teardown(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	const context = { sessionUri: 'copilot:/session', chatUri: 'ahp-chat://copilot/session/chat/default' };
	const stateManager = (workingDirectory: string | undefined) => ({
		getSessionState: () => workingDirectory === undefined ? undefined : { workingDirectories: [URI.file(workingDirectory).toString()] },
	}) as never;

	test('display names the target file', () => {
		const display = getServerToolDisplay(ImageServerToolName.GenerateImage, { path: 'images/cat.png' });
		const file = URI.file(join(root, 'images', 'cat.png')).toString();
		const done = (success: boolean) => getServerToolDisplay(ImageServerToolName.GenerateImage, { path: 'images/cat.png' }, { text: `Saved images/cat.png.\nFile: ${file}`, success })?.pastTenseMessage;
		assert.deepStrictEqual({ invocation: display?.invocationMessage, past: display?.pastTenseMessage, linked: done(true), failed: done(false) }, {
			invocation: 'Generating image images/cat.png',
			past: 'Generated image images/cat.png',
			linked: { markdown: `Generated image [images/cat.png](${file})` },
			failed: 'Generated image images/cat.png',
		});
	});

	test('input defaults to the cheap model and rejects bad arguments', () => {
		assert.deepStrictEqual(parseImageRequest({ prompt: ' a white cat ', path: 'cat.png' }), { prompt: 'a white cat', path: 'cat.png', kind: 'simple', aspectRatio: '16:9' });
		assert.deepStrictEqual([
			{ path: 'cat.png' },
			{ prompt: 'cat', path: 'cat.jpg' },
			{ prompt: 'cat', path: 'cat.png', kind: 'photo' },
			{ prompt: 'cat', path: 'cat.png', aspect_ratio: '4:3' },
		].map(args => { try { parseImageRequest(args); return 'ok'; } catch { return 'rejected'; } }), ['rejected', 'rejected', 'rejected', 'rejected']);
	});

	test('the request key changes with the model and stays stable for a retry', () => {
		const simple = parseImageRequest({ prompt: 'cat', path: 'cat.png' });
		const text = parseImageRequest({ prompt: 'cat', path: 'cat.png', kind: 'text' });
		assert.deepStrictEqual({ stable: imageRequestKey(root, simple) === imageRequestKey(root, { ...simple }), differs: imageRequestKey(root, simple) !== imageRequestKey(root, text) }, { stable: true, differs: true });
	});

	test('target stays inside the project and never overwrites', async () => {
		await fs.writeFile(join(root, 'taken.png'), png);
		const outcome = async (path: string) => { try { await imageTarget(root, path); return 'ok'; } catch (error) { return (error as Error).message; } };
		assert.deepStrictEqual({
			nested: await outcome('images/new/cat.png'),
			escape: await outcome('../cat.png'),
			absolute: await outcome(join(root, 'cat.png')),
			existing: await outcome('taken.png'),
		}, {
			nested: 'ok',
			escape: 'The image must stay inside the project.',
			absolute: 'Choose a relative PNG path inside the project.',
			existing: 'taken.png already exists. Choose a new file name.',
		});
	});

	test('execute saves the PNG in the working directory and reports the charge', async () => {
		const keys: string[] = [];
		const accessor: IImageServerToolAccessor = { isEnabled: () => true, generate: async (_request, key) => { keys.push(key); return { bytes: png, costMicros: 80_000 }; } };
		const group = createImageServerToolGroup(accessor);
		const result = await group.execute(stateManager(root), context, ImageServerToolName.GenerateImage, { prompt: 'a logo with the word Arni', path: 'out/logo.png', kind: 'text' });
		assert.deepStrictEqual({ result, saved: Array.from(await fs.readFile(join(root, 'out', 'logo.png'))).length, keys: keys.length }, {
			result: `Saved out/logo.png (16:9, Stable Diffusion 3.5 Large). Charged $0.08 to the user's API budget.\nFile: ${URI.file(join(await fs.realpath(root), 'out', 'logo.png')).toString()}`,
			saved: png.length,
			keys: 1,
		});
	});

	test('nothing is charged without a project folder or when the file exists', async () => {
		let calls = 0;
		const group = createImageServerToolGroup({ isEnabled: () => true, generate: async () => { calls++; return { bytes: png, costMicros: null }; } });
		await fs.writeFile(join(root, 'cat.png'), png);
		await assert.rejects(() => Promise.resolve(group.execute(stateManager(undefined), context, ImageServerToolName.GenerateImage, { prompt: 'cat', path: 'cat.png' })), /Open a project folder/);
		await assert.rejects(() => Promise.resolve(group.execute(stateManager(root), context, ImageServerToolName.GenerateImage, { prompt: 'cat', path: 'cat.png' })), /already exists/);
		assert.deepStrictEqual({ calls, hidden: createImageServerToolGroup().isEnabled(ImageServerToolName.GenerateImage) }, { calls: 0, hidden: false });
	});

	test('the API gets the model, ratio and idempotency key, then the PNG is downloaded', async () => {
		const requests = new FakeRequestService([
			{ status: 200, body: VSBuffer.fromString(JSON.stringify({ id: 'img-1', model: 'stability.sd3-5-large-v1:0', costMicros: 80_000 })) },
			{ status: 200, body: VSBuffer.wrap(png) },
		]);
		const image = await createArniImageAccessor(requests, () => 'user-jwt').generate(parseImageRequest({ prompt: 'logo', path: 'a.png', kind: 'text', aspect_ratio: '1:1' }), 'k'.repeat(64));
		assert.deepStrictEqual({
			urls: requests.seen.map(request => request.url),
			key: requests.seen[0].headers?.['Idempotency-Key'],
			auth: requests.seen[1].headers?.Authorization,
			body: requests.seen[0].data,
			cost: image.costMicros,
		}, {
			urls: ['https://api.arnion.ru/api/images/generations', 'https://api.arnion.ru/api/images/img-1'],
			key: 'k'.repeat(64),
			auth: 'Bearer user-jwt',
			body: JSON.stringify({ prompt: 'logo', model: 'stability.sd3-5-large-v1:0', aspect_ratio: '1:1', n: 1 }),
			cost: 80_000,
		});
	});

	test('an API refusal is final, keeps its message and is not retried on the other origin', async () => {
		const requests = new FakeRequestService([
			{ status: 400, body: VSBuffer.fromString(JSON.stringify({ error: { code: 'image_prompt_language', message: 'Перепишите prompt на английском' } })) },
		]);
		await assert.rejects(() => createArniImageAccessor(requests, () => 'user-jwt').generate(parseImageRequest({ prompt: 'кот', path: 'a.png' }), 'k'.repeat(64)), /Перепишите prompt на английском/);
		assert.deepStrictEqual({ calls: requests.seen.length, noSignIn: await createArniImageAccessor(requests, () => undefined).generate(parseImageRequest({ prompt: 'cat', path: 'a.png' }), 'k'.repeat(64)).then(() => 'ok', error => (error as Error).message) }, {
			calls: 1,
			noSignIn: 'Image generation requires an Arni sign-in.',
		});
	});

	test('response parsing and PNG check', () => {
		assert.deepStrictEqual([parseGenerationResponse('oops'), parseGenerationResponse(JSON.stringify({ id: '../x', error: 'nope' })), isPng(png), isPng(new Uint8Array(30))], [
			{ costMicros: null },
			{ id: undefined, costMicros: null, message: 'nope' },
			true,
			false,
		]);
	});
});

class FakeRequestService implements IRequestService {
	declare readonly _serviceBrand: undefined;
	readonly onDidCompleteRequest = Event.None;
	readonly seen: IRequestOptions[] = [];

	constructor(private readonly responses: { status: number; body: VSBuffer }[]) { }

	async request(options: IRequestOptions): Promise<{ res: { headers: Record<string, string>; statusCode: number }; stream: ReturnType<typeof bufferToStream> }> {
		this.seen.push(options);
		const next = this.responses.shift() ?? { status: 500, body: VSBuffer.fromString('') };
		return { res: { headers: {}, statusCode: next.status }, stream: bufferToStream(next.body) };
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

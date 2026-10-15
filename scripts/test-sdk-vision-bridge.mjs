/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Real SDK/runtime, synthetic pixel, local HTTP only. No account or provider key.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CopilotClient, RuntimeConnection, approveAll } from '@github/copilot-sdk';
import { resolveByokSessionConfig } from '../out/vs/platform/agentHost/node/copilot/copilotSessionLauncher.js';
import { toSdkHooks } from '../out/vs/platform/agentHost/node/copilot/copilotPluginConverters.js';
import { bridgeResultToResponsesBody, bridgeResultToResponsesSseFrames, responsesRequestToBridge } from '../out/vs/platform/agentHost/node/copilot/byokResponsesTranslation.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arni-sdk-vision-'));
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=';
let calls = 0;
let receivedImages = 0;
let failure;
const server = http.createServer(async (req, res) => {
	try {
		let raw = '';
		for await (const chunk of req) { raw += chunk; }
		const body = JSON.parse(raw);
		calls++;
		if (calls > 1) {
			const request = responsesRequestToBridge('audit', body);
			const parts = request.input.filter(item => item.type === 'function_call_output').flatMap(item => Array.isArray(item.output) ? item.output : []);
			receivedImages = parts.filter(part => part.type === 'image' && part.mimeType === 'image/png' && part.data === pixel).length;
		}
		const result = { output: calls === 1
			? [{ type: 'function_call', callId: 'view-frame', name: 'viewImage', argumentsJson: '{}' }]
			: [{ type: 'message', content: [{ type: 'text', text: 'Кадр просмотрен.' }] }], usage: { inputTokens: 10, outputTokens: 2 } };
		res.setHeader('content-type', body.stream ? 'text/event-stream' : 'application/json');
		res.end(body.stream ? bridgeResultToResponsesSseFrames(result, body.model).join('') : bridgeResultToResponsesBody(result, body.model));
	} catch (error) {
		failure = error;
		res.writeHead(500).end(JSON.stringify({ error: { message: 'Local SDK vision test failed' } }));
	}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const client = new CopilotClient({
	useLoggedInUser: false,
	connection: RuntimeConnection.forStdio({ path: process.argv[2] ?? path.join(root, 'node_modules', '@github', `copilot-${process.platform}-${process.arch}`, 'index.js') }),
	env: { ...process.env, COPILOT_AUTO_UPDATE: 'false' },
	logLevel: 'error',
});
try {
	const config = await resolveByokSessionConfig('local-audit', {
		getModels: () => [{ vendor: 'audit', id: 'vision', supportsVision: true, maxContextWindowTokens: 131072, maxPromptTokens: 65536, maxOutputTokens: 65536 }],
	}, async () => ({ baseUrl, nonce: 'synthetic-local-only', providerBaseUrl: () => baseUrl }), { info() {}, warn() {} });
	await client.start();
	const session = await client.createSession({
		...config, model: 'audit/vision', availableTools: ['viewImage'],
		configDirectory: runDir, workingDirectory: runDir, enableConfigDiscovery: false, enableSessionTelemetry: false,
		largeOutput: { maxSizeBytes: 8192 }, infiniteSessions: { enabled: true },
		onPermissionRequest: approveAll,
		hooks: toSdkHooks([], {
			onPreToolUse: async () => undefined,
			onPostToolUse: async () => undefined,
			onUserPromptSubmitted: () => undefined,
		}),
		tools: [{ name: 'viewImage', description: 'Return a synthetic test pixel', parameters: { type: 'object', properties: {} },
			handler: async () => ({ resultType: 'success', textResultForLlm: 'Attached synthetic pixel', binaryResultsForLlm: [{ type: 'image', mimeType: 'image/png', data: pixel }] }) }],
	});
	const reply = await session.sendAndWait({ prompt: 'Call viewImage, then reply done.' }, 30000);
	if (failure) { throw failure; }
	assert.equal(calls, 2, 'Expected a tool call and one completion');
	assert.equal(receivedImages, 1, 'The SDK must retain the tool image with the actual launcher token limits');
	assert.equal(reply?.data.content, 'Кадр просмотрен.', 'Hooks must not stall final reply and session.idle notifications');
	console.log('SDK vision bridge passed: 2 local requests, 1 image, hooks and final reply completed, no external model calls.');
} finally {
	await client.stop();
	await new Promise(resolve => server.close(resolve));
	const tempRoot = path.resolve(os.tmpdir()) + path.sep;
	assert.ok(path.resolve(runDir).startsWith(tempRoot) && path.basename(runDir).startsWith('arni-sdk-vision-'));
	await fs.rm(runDir, { recursive: true, force: true });
}

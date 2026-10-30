/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Real CLI/SDK, synthetic workbook and local model fixture only. No account or paid API calls.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ZipFile } from 'yazl';
import { CopilotClient, RuntimeConnection, approveAll } from '@github/copilot-sdk';
import { VSBuffer, encodeBase64 } from '../out/vs/base/common/buffer.js';
import { URI } from '../out/vs/base/common/uri.js';
import { MessageAttachmentKind } from '../out/vs/platform/agentHost/common/state/protocol/state.js';
import { prepareSpreadsheetAttachment } from '../out/vs/platform/agentHost/node/copilot/spreadsheetAttachments.js';
import { resolveByokSessionConfig } from '../out/vs/platform/agentHost/node/copilot/copilotSessionLauncher.js';
import { bridgeResultToResponsesBody, bridgeResultToResponsesSseFrames, responsesRequestToBridge } from '../out/vs/platform/agentHost/node/copilot/byokResponsesTranslation.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arni-sdk-xlsx-'));
const source = path.join(runDir, 'Продажи с пробелами.xlsx');
const zip = new ZipFile();
zip.addBuffer(Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'), '[Content_Types].xml');
zip.addBuffer(Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'), '_rels/.rels');
zip.addBuffer(Buffer.from('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>'), 'xl/workbook.xml');
zip.addBuffer(Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'), 'xl/_rels/workbook.xml.rels');
zip.addBuffer(Buffer.from('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="B1" t="inlineStr"><is><t>amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>001</t></is></c><c r="B2" t="n"><v>12</v></c></row></sheetData></worksheet>'), 'xl/worksheets/sheet1.xml');
zip.end();
const chunks = [];
for await (const chunk of zip.outputStream) { chunks.push(chunk); }
const bytes = Buffer.concat(chunks);
await fs.writeFile(source, bytes);
const files = {
	readFile: async resource => ({ value: VSBuffer.wrap(await fs.readFile(resource.fsPath)) }),
	writeFile: async (resource, content) => {
		await fs.mkdir(path.dirname(resource.fsPath), { recursive: true });
		await fs.writeFile(resource.fsPath, content.buffer);
		return { resource };
	},
};
const attachment = await prepareSpreadsheetAttachment({ type: MessageAttachmentKind.Resource, uri: URI.file(source).toString(), label: path.basename(source) }, URI.file(runDir), files);
const embedded = await prepareSpreadsheetAttachment({ type: MessageAttachmentKind.EmbeddedResource, label: path.basename(source), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: encodeBase64(VSBuffer.wrap(bytes)) }, URI.file(runDir), files);
assert.deepEqual(attachment, embedded);
const snapshot = path.join(runDir, 'spreadsheet-attachments', createHash('sha256').update(bytes).digest('hex') + '.xlsx');
let calls = 0;
let toolCalls = 0;
let failure;
const server = http.createServer(async (req, res) => {
	try {
		let raw = '';
		for await (const chunk of req) { raw += chunk; }
		const body = JSON.parse(raw);
		calls++;
		const request = responsesRequestToBridge('audit', body);
		assert.ok(JSON.stringify(request).includes('spreadsheet-attachments'), `The reference must survive subsequent turns/history (call ${calls}): ${JSON.stringify(request.input).slice(-1500)}`);
		assert.ok(!raw.includes('"type":"input_file"'), 'XLSX must not become an unsupported model input_file');
		if (calls === 2) {
			const output = request.input.find(item => item.type === 'function_call_output')?.output;
			assert.ok(typeof output === 'string');
			assert.match(output, /"rows"\s*:\s*1/);
		}
		const result = { output: calls === 1
			? [{ type: 'function_call', callId: 'inspect-book', name: 'inspectWorkbook', argumentsJson: '{}' }]
			: [{ type: 'message', content: [{ type: 'text', text: 'Workbook inspected.' }] }], usage: { inputTokens: 10, outputTokens: 2 } };
		res.setHeader('content-type', body.stream ? 'text/event-stream' : 'application/json');
		res.end(body.stream ? bridgeResultToResponsesSseFrames(result, body.model).join('') : bridgeResultToResponsesBody(result, body.model));
	} catch (error) {
		failure = error;
		res.writeHead(400).end(JSON.stringify({ error: { message: 'Local XLSX fixture failed' } }));
	}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const client = new CopilotClient({ useLoggedInUser: false,
	connection: RuntimeConnection.forStdio({ path: process.argv[2] ?? path.join(root, 'node_modules', '@github', `copilot-${process.platform}-${process.arch}`, 'index.js') }),
	env: { ...process.env, COPILOT_AUTO_UPDATE: 'false', COPILOT_CLI_RUN_AS_NODE: '1' }, logLevel: 'error' });
try {
	const config = await resolveByokSessionConfig('xlsx-audit', { getModels: () => [{ vendor: 'audit', id: 'xlsx', maxContextWindowTokens: 131072 }] },
		async () => ({ baseUrl, nonce: 'local-xlsx-only', providerBaseUrl: () => baseUrl }), { info() {}, warn() {} });
	await client.start();
	const session = await client.createSession({ ...config, model: 'audit/xlsx', configDirectory: runDir, workingDirectory: runDir,
		enableConfigDiscovery: false, enableSessionTelemetry: false, availableTools: ['inspectWorkbook'], onPermissionRequest: approveAll,
		tools: [{ name: 'inspectWorkbook', description: 'Inspect the attached workbook locally', parameters: { type: 'object', properties: {} },
			handler: async () => {
				toolCalls++;
				const result = await execute(process.env.PYTHON ?? 'python', ['-I', path.join(root, 'src/vs/sessions/skills/spreadsheet-analysis/scripts/tables.py'), 'inspect', snapshot],
					{ env: { ...process.env, ARNI_TABLES_RUNTIME_DIR: path.join(runDir, 'runtimes') }, timeout: 210000 });
				assert.equal(JSON.parse(result.stdout).rows, 1);
				return { resultType: 'success', textResultForLlm: result.stdout.trim() };
			} }],
	});
	const answer = await session.sendAndWait({ prompt: `Inspect the attached workbook.\n\n<reminder>\n${attachment.reference}\n</reminder>` }, 240000);
	if (failure) { throw failure; }
	assert.equal(answer?.data.content, 'Workbook inspected.');
	const repeat = await session.sendAndWait({ prompt: 'Confirm the workbook remains available.' }, 30000);
	if (failure) { throw failure; }
	assert.equal(repeat?.data.content, 'Workbook inspected.');
	assert.deepEqual({ calls, toolCalls }, { calls: 3, toolCalls: 1 });
	assert.deepEqual(await fs.readFile(source), bytes);
	assert.deepEqual(await fs.readFile(snapshot), bytes);
	console.log('SDK XLSX passed: resource/pasted attachment, real local workbook read, Unicode path, subsequent turn and original preservation; no paid API calls.');
} catch (error) {
	throw failure ?? error;
} finally {
	await client.stop();
	await new Promise(resolve => server.close(resolve));
	assert.ok(path.resolve(runDir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(runDir).startsWith('arni-sdk-xlsx-'));
	await fs.rm(runDir, { recursive: true, force: true });
}

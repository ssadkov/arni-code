/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Actual input tool against a headless local form. No model, user profile or external website.
// Optional argument: Chromium executable; otherwise use Playwright's installed browser.
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { CancellationToken } from '../out/vs/base/common/cancellation.js';
import { URI } from '../out/vs/base/common/uri.js';
import { TypeBrowserTool } from '../out/vs/workbench/contrib/browserView/electron-browser/tools/typeBrowserTool.js';
import { ClickBrowserTool } from '../out/vs/workbench/contrib/browserView/electron-browser/tools/clickBrowserTool.js';
import { ReadBrowserTool } from '../out/vs/workbench/contrib/browserView/electron-browser/tools/readBrowserTool.js';
import { BrowserToolProgress } from '../out/vs/workbench/contrib/browserView/electron-browser/tools/browserToolProgress.js';

let submissions = 0;
const server = http.createServer((req, res) => {
	if (req.url.startsWith('/submit')) { submissions++; }
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.end(`<!doctype html><form action="/submit">
		<button type="button" id="menu">Form menu</button>
		<button type="button" id="start" onclick="document.querySelector('#questions').hidden=false;this.hidden=true">Начать</button>
		<fieldset id="questions" hidden><legend>Questions</legend><label>Registration email<input id="registration"></label></fieldset>
		<label>Email<input id="email" name="email" value="before@example.test"></label>
		<label>Name<input id="name" name="name" value="Alice"></label>
		<label>BIN<input id="bin" name="bin" value="001234567890"></label>
		<label>Notes<textarea id="notes"></textarea></label>
		<label>Formatted<input id="formatted" oninput="this.value=this.value.toUpperCase()"></label>
		<label>Limited<input id="limited" maxlength="2"></label>
		<label>Read only<input id="readonly" readonly value="keep"></label>
		<label><input type="radio" id="agree" name="consent">Agree</label>
		<div id="editable" contenteditable="true"></div><div id="static">Not editable</div>
		<button id="submit">Submit</button></form>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
let checks = 0;
try {
	browser = await chromium.launch({ headless: true, ...(process.argv[2] ? { executablePath: process.argv[2] } : {}) });
	const page = await browser.newPage();
	page.setDefaultTimeout(500);
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	const run = async (definition, args) => {
		// Only trusted, transpiled product callbacks run here; no model-supplied code.
		const callback = new Function(`return (${definition});`)();
		return callback(page, ...args);
	};
	const service = {
		invokeFunctionRaw: async (_session, _page, definition, ...args) => run(definition, args),
		invokeFunction: async (_session, _page, definition, args) => ({ result: await run(definition, args), summary: await page.locator('form').ariaSnapshot() }),
		getSummary: async () => page.locator('form').ariaSnapshot(),
	};
	const guard = new BrowserToolProgress();
	const tool = new TypeBrowserTool(service, guard);
	const click = new ClickBrowserTool(service, guard);
	const read = new ReadBrowserTool(service, guard);
	let calls = 0;
	const invokeTool = (tool, parameters, request, token = CancellationToken.None) => tool.invoke({
		callId: `call-${++calls}`, toolId: 'type_in_page', chatRequestId: request,
		context: { sessionResource: URI.parse('chat:local-form-test') }, parameters: { pageId: 'local-form', ...parameters },
	}, async () => 0, { report() {} }, token);
	const invoke = (parameters, request = 'request-1', token) => invokeTool(tool, parameters, request, token);
	const verified = result => {
		assert.equal(result.toolResultError, undefined);
		assert.ok(result.content.some(part => part.kind === 'text' && part.value.includes('"verified":true')));
		checks++;
	};
	const failed = result => { assert.ok(result.toolResultError); checks++; };

	await page.locator('#menu').focus();
	failed(await invoke({ element: 'Email field', text: 'wrong@example.test' }));
	assert.equal(await page.locator('#email').inputValue(), 'before@example.test');
	assert.equal(await page.evaluate(() => document.activeElement.id), 'menu');
	failed(await invoke({ ref: 'button[ref=e46]', text: 'wrong@example.test' }));
	verified(await invoke({ selector: '#email', element: 'Email', text: 'new@example.test' }));
	assert.deepEqual(await page.locator('#email, #name, #bin').evaluateAll(inputs => inputs.map(input => input.value)), ['new@example.test', 'Alice', '001234567890']);
	verified(await invoke({ selector: '#email', text: '' }));
	verified(await invoke({ selector: '#notes', text: 'First line\nSecond line' }));
	verified(await invoke({ selector: '#editable', text: 'Editable text' }));
	failed(await invoke({ selector: '#formatted', text: 'lowercase' }));
	failed(await invoke({ selector: '#limited', text: 'too long' }));
	failed(await invoke({ selector: '#readonly', text: 'replace' }));
	failed(await invoke({ selector: '#static', text: 'replace' }));
	failed(await invoke({ selector: '#agree', text: 'Agree' }));
	assert.equal(await page.locator('#agree').isChecked(), false);
	failed(await invoke({ selector: '#email', text: 'cancelled@example.test' }, 'cancelled', CancellationToken.Cancelled));
	assert.equal(await page.locator('#email').inputValue(), '');

	const repeated = { selector: '#name', text: 'Alice', submit: true };
	verified(await invoke(repeated, 'loop'));
	verified(await invoke(repeated, 'loop'));
	const stopped = await invoke(repeated, 'loop');
	failed(stopped);
	assert.equal(stopped.stopCurrentTurn, true);
	verified(await invoke(repeated, 'new-user-message'));
	verified(await invoke({ selector: '#name', text: 'Bob' }, 'loop'));
	verified(await invoke({ selector: '#name', text: 'Alice' }, 'loop'));
	// Descriptions alone must also stop after two rejected calls, without any keyboard input.
	const untargeted = { element: 'consent', text: 'Agree' };
	failed(await invoke(untargeted, 'invalid-loop'));
	failed(await invoke(untargeted, 'invalid-loop'));
	assert.equal((await invoke(untargeted, 'invalid-loop')).stopCurrentTurn, true);
	assert.equal(await page.locator('#agree').isChecked(), false);
	assert.equal(submissions, 0, 'No-op retries must not press Enter and submit a form');
	for (let i = 0; i < 2; i++) {
		failed(await invokeTool(click, { element: 'Начать' }, 'start-loop'));
		assert.equal((await invokeTool(read, {}, 'start-loop')).toolResultError, undefined);
	}
	assert.equal((await invokeTool(click, { element: 'Начать' }, 'start-loop')).stopCurrentTurn, true);
	assert.equal(await page.locator('#questions').isVisible(), false);
	const started = await invokeTool(click, { selector: '#start', element: 'Начать' }, 'start-correct');
	assert.equal(started.toolResultError, undefined);
	assert.ok(started.content.some(part => part.kind === 'text' && part.value.includes('Registration email')));
	verified(await invoke({ selector: '#registration', text: 'draft@example.test' }, 'start-correct'));
	for (let i = 0; i < 2; i++) { assert.equal((await invokeTool(click, { selector: '#menu' }, 'no-op-click')).toolResultError, undefined); }
	assert.equal((await invokeTool(click, { selector: '#menu' }, 'no-op-click')).stopCurrentTurn, true);
	for (let i = 0; i < 2; i++) { assert.equal((await invokeTool(read, {}, 'read-loop')).toolResultError, undefined); }
	assert.equal((await invokeTool(read, {}, 'read-loop')).stopCurrentTurn, true);
	const stale = await invokeTool(click, { selector: '#removed-button' }, 'stale');
	failed(stale);
	assert.equal(await page.locator('#registration').inputValue(), 'draft@example.test');
	assert.equal(await page.locator('#agree').isChecked(), false);
	assert.equal(submissions, 0);
	console.log(`Passed ${checks} real-browser input checks plus Start-to-questions, click/read loop and stale-target checks; no consent selected and no form submitted.`);
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}

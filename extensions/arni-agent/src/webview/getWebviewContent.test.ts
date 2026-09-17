import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARNI_GREETING_EN, ARNI_GREETING_RU, getArniGreeting, getWebviewContent } from './getWebviewContent.ts';

describe('Arni webview content', () => {
	it('defaults the greeting to Russian and uses it for New Chat', () => {
		assert.equal(getArniGreeting(), ARNI_GREETING_RU);
		assert.equal(getArniGreeting('ru'), ARNI_GREETING_RU);
		assert.equal(getArniGreeting('ru-RU'), ARNI_GREETING_RU);
		const html = getWebviewContent({ language: 'ru' });
		assert.ok(html.includes(ARNI_GREETING_RU));
		assert.ok(html.includes(`const ARNI_GREETING = ${JSON.stringify(ARNI_GREETING_RU)}`));
		assert.ok(!html.includes(ARNI_GREETING_EN));
		assert.ok(html.includes('lang="ru"'));
	});

	it('uses English greeting when the workbench locale is English', () => {
		assert.equal(getArniGreeting('en'), ARNI_GREETING_EN);
		const html = getWebviewContent({ language: 'en-US' });
		assert.ok(html.includes(ARNI_GREETING_EN));
		assert.ok(html.includes(`const ARNI_GREETING = ${JSON.stringify(ARNI_GREETING_EN)}`));
		assert.ok(html.includes('lang="en"'));
	});

	it('emits a CSP with a script nonce', () => {
		const html = getWebviewContent();
		assert.match(html, /http-equiv="Content-Security-Policy"/);
		assert.match(html, /script-src 'nonce-[A-Za-z0-9]+'/);
		assert.match(html, /<script nonce="[A-Za-z0-9]+">/);
		assert.ok(html.includes("vscode.postMessage({ type: 'saveApiKey', value: key })"));
		assert.ok(html.includes("vscode.postMessage({ type: 'checkApiKey' })"));
	});
});

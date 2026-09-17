import * as http from 'node:http';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { LoopbackServer } from './loopbackServer.ts';

describe('LoopbackServer OAuth callback', () => {
    let server: LoopbackServer | undefined;

    afterEach(() => {
        server?.stop();
        server = undefined;
    });

    async function started(): Promise<{ port: number; instance: LoopbackServer }> {
        const instance = new LoopbackServer();
        server = instance;
        const port = await instance.start();
        return { port, instance };
    }

    it('resolves when state matches', async () => {
        const { port, instance } = await started();
        const wait = instance.waitForCode('good-state', 5000);
        const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=good-state`);
        assert.equal(res.status, 200);
        const result = await wait;
        assert.equal(result.code, 'abc');
    });

    it('rejects CSRF mismatches immediately instead of hanging until timeout', async () => {
        const { port, instance } = await started();
        const wait = instance.waitForCode('expected-state', 300000);
        const startedAt = Date.now();
        const [res] = await Promise.all([
            fetch(`http://127.0.0.1:${port}/callback?code=abc&state=attacker-state`),
            assert.rejects(wait, /CSRF/)
        ]);
        assert.equal(res.status, 400);
        assert.ok(Date.now() - startedAt < 2000, 'CSRF failure must not wait for the 5 minute timeout');
    });

    it('escapes error_description in the loopback HTML (C6 XSS)', async () => {
        const { port, instance } = await started();
        const wait = instance.waitForCode('expected-state', 5000);
        const payload = '<img src=x onerror=alert(1)>';
        const [res] = await Promise.all([
            fetch(`http://127.0.0.1:${port}/callback?error=access_denied&error_description=${encodeURIComponent(payload)}&state=expected-state`),
            assert.rejects(wait, /onerror/)
        ]);
        const html = await res.text();
        assert.equal(res.status, 400);
        assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
        assert.ok(!html.includes('<img src=x'));
    });

    it('rejects OAuth error redirects immediately', async () => {
        const { port, instance } = await started();
        const wait = instance.waitForCode('expected-state', 300000);
        const startedAt = Date.now();
        const [res] = await Promise.all([
            fetch(`http://127.0.0.1:${port}/callback?error=access_denied&error_description=denied&state=expected-state`),
            assert.rejects(wait, /denied/)
        ]);
        assert.equal(res.status, 400);
        assert.ok(Date.now() - startedAt < 2000);
    });

    it('still succeeds if the browser callback arrives before waitForCode is attached', async () => {
        const { port, instance } = await started();
        const callback = fetch(`http://127.0.0.1:${port}/callback?code=early&state=good-state`);
        await new Promise(resolve => setTimeout(resolve, 30));
        const wait = instance.waitForCode('good-state', 5000);
        const [res, result] = await Promise.all([callback, wait]);
        assert.equal(res.status, 200);
        assert.equal(result.code, 'early');
    });
});

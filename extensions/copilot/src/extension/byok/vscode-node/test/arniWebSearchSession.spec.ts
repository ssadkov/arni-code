/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { exchangeArniWebSearchSession } from '../arniWebSearchSession';

describe('Arni web search session exchange', () => {
	it.each(['yandex', 'vk', 'google'])('exchanges the %s access token in the Node host', async provider => {
		const calls: { url: string; init: RequestInit | undefined }[] = [];
		const result = await exchangeArniWebSearchSession(provider, 'oauth-token', async (url, init) => {
			calls.push({ url: String(url), init });
			return Response.json({ token: 'arni-jwt' });
		});
		expect(result).toEqual({ status: 200, token: 'arni-jwt' });
		expect(calls.map(call => [call.url, call.init?.body, call.init?.redirect])).toEqual([
			['https://api.arnion.ru/api/auth/exchange', JSON.stringify({ provider, token: 'oauth-token' }), 'error'],
		]);
	});

	it.each([401, 403, 500, 503, 'network'])('handles %s without retrying permanent failures', async first => {
		const urls: string[] = [];
		const result = await exchangeArniWebSearchSession('yandex', 'oauth-token', async url => {
			urls.push(String(url));
			if (urls.length === 1) {
				if (first === 'network') { throw new Error('oauth-token'); }
				return new Response('', { status: first as number });
			}
			return Response.json({ token: 'arni-jwt' });
		});
		const retry = first === 503 || first === 'network';
		expect({ result, urls }).toEqual({
			result: retry ? { status: 200, token: 'arni-jwt' } : { status: first },
			urls: retry ? ['https://api.arnion.ru/api/auth/exchange', 'https://arni-backend.vercel.app/api/auth/exchange'] : ['https://api.arnion.ru/api/auth/exchange'],
		});
	});

	it('returns a sanitized unavailable status when both networks fail', async () => {
		expect(await exchangeArniWebSearchSession('vk', 'oauth-token', async () => { throw new Error('oauth-token'); })).toEqual({ status: 503 });
	});

	it('does not treat malformed success as a session or retry it', async () => {
		let calls = 0;
		expect(await exchangeArniWebSearchSession('google', 'oauth-token', async () => { calls++; return Response.json({ user: {} }); })).toEqual({ status: 502 });
		expect(calls).toBe(1);
	});
});

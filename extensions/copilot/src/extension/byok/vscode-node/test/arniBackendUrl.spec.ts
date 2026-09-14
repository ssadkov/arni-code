/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { readArniJwtFromExchangeBody, resolveArniApiBaseUrl, resolveArniAuthExchangeUrl } from '../arniBackendUrl';

describe('resolveArniApiBaseUrl', () => {
	it('defaults to the Vercel origin plus /api', () => {
		expect(resolveArniApiBaseUrl()).toBe('https://arni-backend.vercel.app/api');
		expect(resolveArniApiBaseUrl('')).toBe('https://arni-backend.vercel.app/api');
	});

	it('appends /api to a bare origin and does not double it', () => {
		expect(resolveArniApiBaseUrl('https://arni-backend.vercel.app')).toBe('https://arni-backend.vercel.app/api');
		expect(resolveArniApiBaseUrl('https://arni-backend.vercel.app/')).toBe('https://arni-backend.vercel.app/api');
		expect(resolveArniApiBaseUrl('https://arni-backend.vercel.app/api')).toBe('https://arni-backend.vercel.app/api');
		expect(resolveArniApiBaseUrl('https://arni-backend.vercel.app/api/')).toBe('https://arni-backend.vercel.app/api');
	});

	it('builds the auth exchange path under /api', () => {
		expect(resolveArniAuthExchangeUrl('https://arni-backend.vercel.app')).toBe('https://arni-backend.vercel.app/api/auth/exchange');
	});
});

describe('readArniJwtFromExchangeBody', () => {
	it('prefers token, then access_token, then jwt', () => {
		expect(readArniJwtFromExchangeBody({ token: 'a', access_token: 'b' })).toBe('a');
		expect(readArniJwtFromExchangeBody({ access_token: 'b' })).toBe('b');
		expect(readArniJwtFromExchangeBody({ jwt: 'c' })).toBe('c');
		expect(readArniJwtFromExchangeBody({})).toBeUndefined();
	});
});

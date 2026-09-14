import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveArniApiBaseUrl, resolveArniAuthExchangeUrl, resolveArniChatCompletionsUrl, readArniJwtFromExchangeBody } from './arniBackend.ts';

describe('resolveArniApiBaseUrl', () => {
	it('defaults to the Vercel origin plus /api', () => {
		assert.equal(resolveArniApiBaseUrl(), 'https://arni-backend.vercel.app/api');
		assert.equal(resolveArniApiBaseUrl(''), 'https://arni-backend.vercel.app/api');
		assert.equal(resolveArniApiBaseUrl('   '), 'https://arni-backend.vercel.app/api');
	});

	it('appends /api to a bare origin', () => {
		assert.equal(resolveArniApiBaseUrl('https://arni-backend.vercel.app'), 'https://arni-backend.vercel.app/api');
		assert.equal(resolveArniApiBaseUrl('https://arni-backend.vercel.app/'), 'https://arni-backend.vercel.app/api');
	});

	it('does not double /api when already present', () => {
		assert.equal(resolveArniApiBaseUrl('https://arni-backend.vercel.app/api'), 'https://arni-backend.vercel.app/api');
		assert.equal(resolveArniApiBaseUrl('https://arni-backend.vercel.app/api/'), 'https://arni-backend.vercel.app/api');
	});
});

describe('Arni backend routes', () => {
	it('builds exchange and chat URLs under /api', () => {
		assert.equal(resolveArniAuthExchangeUrl('https://arni-backend.vercel.app'), 'https://arni-backend.vercel.app/api/auth/exchange');
		assert.equal(resolveArniChatCompletionsUrl('https://arni-backend.vercel.app'), 'https://arni-backend.vercel.app/api/chat/completions');
	});
});

describe('readArniJwtFromExchangeBody', () => {
	it('prefers token, then access_token, then jwt', () => {
		assert.equal(readArniJwtFromExchangeBody({ token: 'a', access_token: 'b' }), 'a');
		assert.equal(readArniJwtFromExchangeBody({ access_token: 'b' }), 'b');
		assert.equal(readArniJwtFromExchangeBody({ jwt: 'c' }), 'c');
		assert.equal(readArniJwtFromExchangeBody({}), undefined);
	});
});

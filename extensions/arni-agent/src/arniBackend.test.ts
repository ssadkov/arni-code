import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveArniApiBaseUrl, resolveArniAuthExchangeUrl, resolveArniChatCompletionsUrl, readArniJwtFromExchangeBody, readCachedArniJwt, serializeCachedArniJwt, JWT_FALLBACK_TTL_MS, JWT_REFRESH_SKEW_MS, DEFAULT_ARNI_MODEL_ID, resolveProviderBaseUrl, resolveSidebarChatRequest } from './arniBackend.ts';

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

function jwtWithExp(expSeconds: number): string {
	const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
	const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
	return `${header}.${payload}.sig`;
}

describe('cached Arni JWT TTL', () => {
	it('reads exp from a JWT and treats near-expiry as stale', () => {
		const now = 1_700_000_000_000;
		const fresh = jwtWithExp(Math.floor((now + 60 * 60 * 1000) / 1000));
		const stored = serializeCachedArniJwt(fresh, now);
		assert.equal(readCachedArniJwt(stored, now), fresh);

		const soon = jwtWithExp(Math.floor((now + 60 * 1000) / 1000));
		assert.equal(readCachedArniJwt(serializeCachedArniJwt(soon, now), now), undefined);
	});

	it('applies fallback TTL when the JWT has no exp', () => {
		const now = 1_700_000_000_000;
		const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
		const payload = Buffer.from(JSON.stringify({ sub: 'arni' })).toString('base64url');
		const jwt = `${header}.${payload}.sig`;
		const stored = serializeCachedArniJwt(jwt, now);
		assert.equal(readCachedArniJwt(stored, now), jwt);
		assert.equal(readCachedArniJwt(stored, now + JWT_FALLBACK_TTL_MS - JWT_REFRESH_SKEW_MS - 1000), jwt);
		assert.equal(readCachedArniJwt(stored, now + JWT_FALLBACK_TTL_MS - JWT_REFRESH_SKEW_MS), undefined);
	});

	it('treats a legacy raw JWT without exp as stale so it is re-exchanged', () => {
		const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
		const payload = Buffer.from(JSON.stringify({ sub: 'legacy' })).toString('base64url');
		const jwt = `${header}.${payload}.sig`;
		assert.equal(readCachedArniJwt(jwt, Date.now()), undefined);
	});
});

describe('resolveProviderBaseUrl', () => {
	it('uses custom apiBaseUrl when set', () => {
		assert.equal(resolveProviderBaseUrl('openai', 'https://example.com/v1/'), 'https://example.com/v1');
	});

	it('maps anthropic instead of falling through to api.arni.ai', () => {
		assert.equal(resolveProviderBaseUrl('anthropic'), 'https://api.anthropic.com/v1');
		assert.ok(!resolveProviderBaseUrl('anthropic').includes('api.arni.ai'));
	});

	it('maps arni and unknown names to the live Arni backend /api base', () => {
		assert.equal(resolveProviderBaseUrl('arni'), 'https://arni-backend.vercel.app/api');
		assert.equal(resolveProviderBaseUrl('not-a-provider'), 'https://arni-backend.vercel.app/api');
		assert.equal(resolveProviderBaseUrl('arni', undefined, 'https://staging.example/api'), 'https://staging.example/api');
	});
});

describe('resolveSidebarChatRequest', () => {
	it('uses Yandex JWT + Arni backend and the configured model by default', () => {
		const req = resolveSidebarChatRequest({
			provider: 'openrouter',
			modelId: 'qwen/qwen-2.5-coder-32b-instruct',
			backendUrl: 'https://arni-backend.vercel.app',
			hasYandexSession: true,
			hasApiKey: false
		});
		assert.equal(req.useJwt, true);
		assert.equal(req.baseUrl, 'https://arni-backend.vercel.app/api');
		assert.equal(req.modelId, 'qwen/qwen-2.5-coder-32b-instruct');
	});

	it('uses a stored OpenRouter key when there is no Yandex session', () => {
		const req = resolveSidebarChatRequest({
			provider: 'openrouter',
			apiBaseUrl: 'https://openrouter.ai/api/v1',
			hasYandexSession: false,
			hasApiKey: true
		});
		assert.equal(req.useJwt, false);
		assert.equal(req.baseUrl, 'https://openrouter.ai/api/v1');
		assert.equal(req.modelId, DEFAULT_ARNI_MODEL_ID);
	});

	it('honors a direct BYOK provider even when a Yandex session exists', () => {
		const req = resolveSidebarChatRequest({
			provider: 'openai',
			hasYandexSession: true,
			hasApiKey: true
		});
		assert.equal(req.useJwt, false);
		assert.equal(req.baseUrl, 'https://api.openai.com/v1');
	});
});

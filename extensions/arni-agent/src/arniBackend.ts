export const DEFAULT_ARNI_BACKEND_ORIGIN = 'https://arni-backend.vercel.app';

/**
 * Normalize `arni.backendUrl` (origin or origin+/api) to the Arni API base.
 * Live backend routes live under `/api/*` (Next.js), not the site origin.
 */
export function resolveArniApiBaseUrl(backendUrl?: string): string {
	const trimmed = (backendUrl ?? '').trim().replace(/\/+$/, '');
	const origin = trimmed || DEFAULT_ARNI_BACKEND_ORIGIN;
	return origin.endsWith('/api') ? origin : `${origin}/api`;
}

export function resolveArniAuthExchangeUrl(backendUrl?: string): string {
	return `${resolveArniApiBaseUrl(backendUrl)}/auth/exchange`;
}

export function resolveArniChatCompletionsUrl(backendUrl?: string): string {
	return `${resolveArniApiBaseUrl(backendUrl)}/chat/completions`;
}

export function readArniJwtFromExchangeBody(body: { token?: unknown; access_token?: unknown; jwt?: unknown }): string | undefined {
	for (const value of [body.token, body.access_token, body.jwt]) {
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

/** Re-exchange this many milliseconds before JWT `exp`. */
export const JWT_REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Used when the JWT has no `exp` claim. */
export const JWT_FALLBACK_TTL_MS = 45 * 60 * 1000;

export interface CachedArniJwt {
	token: string;
	expiresAt: number;
}

function decodeBase64UrlJson(segment: string): unknown {
	const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
	const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
	return JSON.parse(Buffer.from(padded + pad, 'base64').toString('utf8'));
}

export function decodeJwtExpMs(jwt: string): number | undefined {
	const parts = jwt.split('.');
	if (parts.length < 2) {
		return undefined;
	}
	try {
		const payload = decodeBase64UrlJson(parts[1]);
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			return undefined;
		}
		const exp = (payload as { exp?: unknown }).exp;
		if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
			return exp * 1000;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export function serializeCachedArniJwt(jwt: string, now = Date.now()): string {
	return JSON.stringify({
		token: jwt,
		expiresAt: decodeJwtExpMs(jwt) ?? now + JWT_FALLBACK_TTL_MS
	} satisfies CachedArniJwt);
}

function parseCachedArniJwt(raw: string): CachedArniJwt | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}
	if (trimmed.startsWith('{')) {
		try {
			const parsed = JSON.parse(trimmed) as Partial<CachedArniJwt>;
			if (typeof parsed.token === 'string' && parsed.token.length > 0) {
				const expiresAt = typeof parsed.expiresAt === 'number'
					? parsed.expiresAt
					: (decodeJwtExpMs(parsed.token) ?? 0);
				return { token: parsed.token, expiresAt };
			}
		} catch {
			return undefined;
		}
		return undefined;
	}
	// Legacy SecretStorage value: raw JWT string.
	return {
		token: trimmed,
		expiresAt: decodeJwtExpMs(trimmed) ?? 0
	};
}

export function readCachedArniJwt(raw: string | undefined, now = Date.now(), skewMs = JWT_REFRESH_SKEW_MS): string | undefined {
	if (!raw) {
		return undefined;
	}
	const cached = parseCachedArniJwt(raw);
	if (!cached) {
		return undefined;
	}
	if (!cached.expiresAt || cached.expiresAt - now <= skewMs) {
		return undefined;
	}
	return cached.token;
}

export const DEFAULT_ARNI_MODEL_ID = 'qwen/qwen-2.5-coder-32b-instruct';

const DIRECT_BYOK_PROVIDERS = new Set([
	'openai',
	'anthropic',
	'deepseek',
	'ollama',
	'custom'
]);

export interface SidebarChatSettings {
	provider?: string;
	apiBaseUrl?: string;
	backendUrl?: string;
	modelId?: string;
	enableStreaming?: boolean;
	hasYandexSession: boolean;
	hasApiKey: boolean;
}

export interface SidebarChatRequest {
	baseUrl: string;
	modelId: string;
	enableStreaming: boolean;
	useJwt: boolean;
}

export function normalizeProviderName(providerName?: string): string {
	return (providerName ?? 'openrouter').trim().toLowerCase() || 'openrouter';
}

/**
 * Resolve the OpenAI-compatible `/chat/completions` base URL for a provider.
 * `arni` (and unknown names) use the live Arni backend, not the dead `api.arni.ai` host.
 */
export function resolveProviderBaseUrl(providerName?: string, apiBaseUrl?: string, backendUrl?: string): string {
	const custom = (apiBaseUrl ?? '').trim().replace(/\/+$/, '');
	if (custom) {
		return custom;
	}

	switch (normalizeProviderName(providerName)) {
		case 'openai':
			return 'https://api.openai.com/v1';
		case 'anthropic':
			return 'https://api.anthropic.com/v1';
		case 'deepseek':
			return 'https://api.deepseek.com/v1';
		case 'ollama':
			return 'http://localhost:11434/v1';
		case 'openrouter':
			return 'https://openrouter.ai/api/v1';
		case 'arni':
		default:
			return resolveArniApiBaseUrl(backendUrl);
	}
}

/**
 * Sidebar chat routing:
 * - Yandex JWT → Arni `{backendUrl}/api/chat/completions` (product default, including `openrouter`)
 * - Stored API key + a direct provider (`openai`, `anthropic`, …) → BYOK
 * - Stored API key + `openrouter` without a Yandex session → OpenRouter directly
 */
export function resolveSidebarChatRequest(settings: SidebarChatSettings): SidebarChatRequest {
	const provider = normalizeProviderName(settings.provider);
	const modelId = (settings.modelId ?? '').trim() || DEFAULT_ARNI_MODEL_ID;
	const enableStreaming = settings.enableStreaming ?? true;

	if (settings.hasApiKey && DIRECT_BYOK_PROVIDERS.has(provider)) {
		return {
			baseUrl: resolveProviderBaseUrl(provider, settings.apiBaseUrl, settings.backendUrl),
			modelId,
			enableStreaming,
			useJwt: false
		};
	}

	if (settings.hasApiKey && !settings.hasYandexSession && provider === 'openrouter') {
		return {
			baseUrl: resolveProviderBaseUrl(provider, settings.apiBaseUrl, settings.backendUrl),
			modelId,
			enableStreaming,
			useJwt: false
		};
	}

	return {
		baseUrl: resolveArniApiBaseUrl(settings.backendUrl),
		modelId,
		enableStreaming,
		useJwt: true
	};
}

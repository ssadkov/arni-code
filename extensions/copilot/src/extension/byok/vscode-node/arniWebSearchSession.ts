/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Mirrored by the workbench's agentHost/common/arniApi.ts. Never returns a provider access token. */
export const ARNI_EXCHANGE_WEB_SEARCH_SESSION_COMMAND = 'arni.exchangeWebSearchSession';

export interface IArniSessionExchangeResult {
	readonly status: number;
	readonly token?: string;
}

/** Runs in the Node extension host; the Exa key stays on the API. */
export async function exchangeArniWebSearchSession(provider: string, accessToken: string, fetcher: typeof fetch = fetch): Promise<IArniSessionExchangeResult> {
	if (!['yandex', 'vk', 'google'].includes(provider) || !accessToken.trim()) {
		return { status: 400 };
	}
	for (const origin of ['https://api.arnion.ru', 'https://arni-backend.vercel.app']) {
		let response: Response;
		try {
			response = await fetcher(`${origin}/api/auth/exchange`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider, token: accessToken }),
				signal: AbortSignal.timeout(20_000),
				redirect: 'error',
			});
		} catch {
			continue;
		}
		if (response.status === 503) {
			continue;
		}
		if (!response.ok) {
			return { status: response.status };
		}
		let body: string;
		try {
			body = await response.text();
		} catch {
			continue;
		}
		try {
			const data = JSON.parse(body) as { token?: unknown };
			return typeof data.token === 'string' && data.token.trim()
				? { status: response.status, token: data.token }
				: { status: 502 };
		} catch {
			return { status: 502 };
		}
	}
	return { status: 503 };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

export function readArniJwtFromExchangeBody(body: { token?: unknown; access_token?: unknown; jwt?: unknown }): string | undefined {
	for (const value of [body.token, body.access_token, body.jwt]) {
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

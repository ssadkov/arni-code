/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { streamToBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { ARNI_API_ORIGINS } from '../../common/arniApi.js';
import { IRequestService } from '../../../request/common/request.js';
import type { IWebSearchHit, IWebSearchQuery, IWebSearchServerToolAccessor } from './webSearchServerTools.js';

const SEARCH_TIMEOUT_MS = 20_000;

/**
 * Calls the shared Arni API, which holds the Exa key. The user token is the
 * Arni session JWT.
 */
export function createArniWebSearchAccessor(requestService: IRequestService, readUserToken: () => string | undefined): IWebSearchServerToolAccessor {
	return {
		isEnabled(): boolean {
			return true;
		},
		async search(query: IWebSearchQuery): Promise<readonly IWebSearchHit[]> {
			const token = readUserToken()?.trim();
			if (!token) {
				throw new Error('Web search requires an Arni sign-in.');
			}
			let lastError: Error | undefined;
			for (const origin of ARNI_API_ORIGINS) {
				try {
					return await searchOrigin(requestService, origin, token, query);
				} catch (error) {
					const wrapped = error instanceof Error ? error : new Error(getErrorMessage(error));
					if (wrapped.message.startsWith('Web search is not authorized') || wrapped.message.startsWith('Web search returned')) {
						throw wrapped;
					}
					lastError = wrapped;
				}
			}
			throw lastError ?? new Error('Web search failed.');
		},
	};
}

async function searchOrigin(requestService: IRequestService, origin: string, token: string, query: IWebSearchQuery): Promise<readonly IWebSearchHit[]> {
	let statusCode: number | undefined;
	try {
		const context = await requestService.request({
			type: 'POST',
			url: `${origin}/api/web-search`,
			timeout: SEARCH_TIMEOUT_MS,
			callSite: 'agentHost.webSearch',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`,
			},
			data: JSON.stringify({
				query: query.query,
				count: query.count,
				...(query.country ? { country: query.country } : {}),
				...(query.searchLang ? { search_lang: query.searchLang } : {}),
			}),
		}, CancellationToken.None);
		statusCode = context.res.statusCode;
		const body = (await streamToBuffer(context.stream)).toString();
		if (statusCode === 401 || statusCode === 403) {
			throw new Error('Web search is not authorized. Sign in to Arni again.');
		}
		if (statusCode === undefined || statusCode < 200 || statusCode >= 300) {
			throw new Error(statusCode === 503 ? 'Web search is unavailable.' : `Web search failed (HTTP ${statusCode}).`);
		}
		return parseArniWebSearchResponse(body);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith('Web search')) {
			throw error;
		}
		throw new Error(`Web search failed: ${getErrorMessage(error)}`);
	}
}

/** Maps the shared API JSON into hits. Non-http(s) URLs are dropped. */
export function parseArniWebSearchResponse(body: string): readonly IWebSearchHit[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new Error('Web search returned a response that was not JSON.');
	}
	const results = parsed && typeof parsed === 'object' ? (parsed as { results?: unknown }).results : undefined;
	if (!Array.isArray(results)) {
		return [];
	}
	const hits: IWebSearchHit[] = [];
	for (const result of results) {
		if (!result || typeof result !== 'object') {
			continue;
		}
		const record = result as { title?: unknown; url?: unknown; snippet?: unknown };
		if (typeof record.title !== 'string' || typeof record.url !== 'string') {
			continue;
		}
		let url: URL;
		try {
			url = new URL(record.url);
		} catch {
			continue;
		}
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			continue;
		}
		hits.push({
			title: record.title,
			url: record.url,
			description: typeof record.snippet === 'string' ? record.snippet : '',
		});
	}
	return hits;
}

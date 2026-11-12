/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { streamToBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { localize } from '../../../../nls.js';
import { ARNI_API_ORIGINS } from '../../common/arniApi.js';
import { IRequestService } from '../../../request/common/request.js';
import { WEB_SEARCH_MAX_RESULTS, type IWebSearchHit, type IWebSearchQuery, type IWebSearchServerToolAccessor } from './webSearchServerTools.js';

const SEARCH_TIMEOUT_MS = 20_000;

class WebSearchError extends Error {
	constructor(message: string, readonly retryable = false) {
		super(message);
	}
}

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
				throw new WebSearchError(localize('webSearch.signIn', "Web search requires an Arni sign-in. Sign in again."));
			}
			let lastError: Error | undefined;
			for (const origin of ARNI_API_ORIGINS) {
				try {
					return await searchOrigin(requestService, origin, token, query);
				} catch (error) {
					if (!(error instanceof WebSearchError) || !error.retryable) {
						throw error;
					}
					lastError = error;
				}
			}
			throw lastError ?? new WebSearchError(localize('webSearch.failed', "Web search failed."));
		},
	};
}

async function searchOrigin(requestService: IRequestService, origin: string, token: string, query: IWebSearchQuery): Promise<readonly IWebSearchHit[]> {
	let context;
	try {
		context = await requestService.request({
			type: 'POST',
			url: `${origin}/api/web-search`,
			timeout: SEARCH_TIMEOUT_MS,
			followRedirects: 0,
			callSite: 'agentHost.webSearch',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`,
			},
			data: JSON.stringify({ query: query.query }),
		}, CancellationToken.None);
	} catch {
		// Transport errors can contain request headers. Never forward them to a model or log.
		throw new WebSearchError(localize('webSearch.network', "Web search is unavailable. Check your internet connection and try again."), true);
	}
	const status = context.res.statusCode;
	if (status === 401) {
		throw new WebSearchError(localize('webSearch.unauthorized', "Sign in to Arni again to use web search."));
	}
	if (status === 403) {
		throw new WebSearchError(localize('webSearch.forbidden', "Web search is not available for this account."));
	}
	if (status === 503) {
		throw new WebSearchError(localize('webSearch.unavailable', "Web search is currently unavailable. Try again later."), true);
	}
	if (status === undefined || status < 200 || status >= 300) {
		throw new WebSearchError(localize('webSearch.httpError', "Web search failed (HTTP {0}).", status ?? 'unknown'));
	}
	let body: string;
	try {
		body = (await streamToBuffer(context.stream)).toString();
	} catch {
		throw new WebSearchError(localize('webSearch.interrupted', "The web search response was interrupted. Try again."), true);
	}
	return parseArniWebSearchResponse(body);
}

/** Maps the shared API JSON into hits. Non-http(s) URLs are dropped. */
export function parseArniWebSearchResponse(body: string): readonly IWebSearchHit[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new WebSearchError(localize('webSearch.invalidJson', "Web search returned a response that was not JSON."));
	}
	const results = parsed && typeof parsed === 'object' ? (parsed as { results?: unknown }).results : undefined;
	if (!Array.isArray(results)) {
		throw new WebSearchError(localize('webSearch.invalidResults', "Web search returned an invalid response."));
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
		if (hits.length === WEB_SEARCH_MAX_RESULTS) { break; }
	}
	return hits;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Transport errors that require a changed request or account, rather than a retry. */
export function isNonRetryableBYOKError(message: string): boolean {
	if (/\b(?:request failed:|http(?: status)?[: ]*|status(?: code)?[: =]*)\s*(?:400|401|403|404|413|422)\b/i.test(message)) {
		return true;
	}
	const start = message.indexOf('{');
	if (start < 0) { return false; }
	try {
		const body = JSON.parse(message.slice(start));
		const code = body?.error?.code ?? body?.code;
		return typeof code === 'string' && new Set([
			'insufficient_budget', 'five_hour_limit', 'weekly_limit', 'access_expired',
			'account_blocked', 'request_in_progress', 'free_daily_limit', 'pricing_unavailable',
			'context_too_large', 'context_length_exceeded', 'unsupported_request',
		]).has(code);
	} catch { return false; }
}

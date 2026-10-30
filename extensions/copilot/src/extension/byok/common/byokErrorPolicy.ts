/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Transport errors that require a changed request or account, rather than a retry. */
export function isNonRetryableBYOKError(message: string): boolean {
	return /\b(?:request failed:|http(?: status)?[: ]*|status(?: code)?[: =]*)\s*(?:400|401|403|404|413|422)\b/i.test(message);
}

export interface IArniBudgetError {
	readonly code: 'five_hour_limit' | 'weekly_limit' | 'insufficient_budget';
	readonly resetsAt?: Date;
}

/** Find an Arni budget refusal in the JSON that the transport appends to "Rate limit exceeded". */
export function parseArniBudgetError(message: string): IArniBudgetError | undefined {
	const start = message.indexOf('{');
	if (start === -1) {
		return undefined;
	}
	let body: { code?: unknown; resetsAt?: unknown; error?: { code?: unknown; resetsAt?: unknown } };
	try {
		body = JSON.parse(message.slice(start));
	} catch {
		return undefined;
	}
	const details = body.error ?? body;
	if (details.code !== 'five_hour_limit' && details.code !== 'weekly_limit' && details.code !== 'insufficient_budget') {
		return undefined;
	}
	const resetsAt = typeof details.resetsAt === 'string' ? new Date(details.resetsAt) : undefined;
	return { code: details.code, resetsAt: resetsAt && !isNaN(resetsAt.getTime()) ? resetsAt : undefined };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Transport errors that require a changed request or account, rather than a retry. */
export function isNonRetryableBYOKError(message: string): boolean {
	return /\b(?:request failed:|http(?: status)?[: ]*|status(?: code)?[: =]*)\s*(?:400|401|403|404|413|422)\b/i.test(message);
}

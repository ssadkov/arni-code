/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IAuthenticationService } from './authentication.js';

/** Product sign-in providers for Arni Code. GitHub is not required. */
export const ARNI_PRODUCT_AUTH_PROVIDERS: readonly { id: string; label: string }[] = [
	{ id: 'yandex', label: 'Yandex' },
	{ id: 'vk', label: 'VK' },
];

/** True when a Yandex or VK session exists. Bound in workbench and Agents window. */
export const ArniAccountSignedInContext = new RawContextKey<boolean>('arniAccountSignedIn', false);

export function isArniProductAuthProvider(providerId: string): boolean {
	return ARNI_PRODUCT_AUTH_PROVIDERS.some(provider => provider.id === providerId);
}

/**
 * True when the user has a Yandex or VK session. That is enough to use
 * Agents and product models without a GitHub Copilot account.
 */
export async function hasArniProductSignIn(
	authenticationService: IAuthenticationService,
	activateImmediate = true,
): Promise<boolean> {
	for (const provider of ARNI_PRODUCT_AUTH_PROVIDERS) {
		try {
			const sessions = await authenticationService.getSessions(provider.id, undefined, undefined, activateImmediate);
			if (sessions.length > 0) {
				return true;
			}
		} catch {
			// Provider is not registered yet.
		}
	}
	return false;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ARNI_API_ORIGINS, ARNI_API_RESOURCE } from '../../../../../../platform/agentHost/common/arniApi.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ARNI_PRODUCT_AUTH_PROVIDERS } from '../../../../../services/authentication/common/arniProductAuth.js';
import { IAuthenticationService } from '../../../../../services/authentication/common/authentication.js';

/**
 * Exchanges the signed-in Yandex, VK or Google session for an Arni API token
 * and forwards it to the Agent Host. The host uses it only to call web search.
 * The Exa key stays on the API.
 */
export async function publishArniWebSearchToken(
	authenticationService: IAuthenticationService,
	agentHostService: IAgentHostService,
	logService: ILogService,
): Promise<void> {
	for (const provider of ARNI_PRODUCT_AUTH_PROVIDERS) {
		let accessToken: string | undefined;
		try {
			accessToken = (await authenticationService.getSessions(provider.id))[0]?.accessToken;
		} catch {
			continue;
		}
		if (!accessToken) {
			continue;
		}
		const jwt = await exchangeArniSession(provider.id, accessToken, logService);
		if (!jwt) {
			continue;
		}
		await agentHostService.authenticate({ resource: ARNI_API_RESOURCE, token: jwt });
		return;
	}
	await agentHostService.authenticate({ resource: ARNI_API_RESOURCE, token: '' });
}

async function exchangeArniSession(provider: string, accessToken: string, logService: ILogService): Promise<string | undefined> {
	for (const origin of ARNI_API_ORIGINS) {
		try {
			const response = await fetch(`${origin}/api/auth/exchange`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider, token: accessToken }),
			});
			if (!response.ok) {
				logService.warn(`[AgentHost] Arni session exchange failed (${response.status})`);
				continue;
			}
			const data = await response.json() as { token?: unknown };
			if (typeof data.token === 'string' && data.token.length > 0) {
				return data.token;
			}
		} catch (error) {
			logService.warn(`[AgentHost] Arni session exchange failed: ${error instanceof Error ? error.name : 'unknown'}`);
		}
	}
	return undefined;
}

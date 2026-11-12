/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../../base/common/observable.js';
import { ARNI_API_RESOURCE, ARNI_EXCHANGE_WEB_SEARCH_SESSION_COMMAND, IArniSessionExchangeResult } from '../../../../../../platform/agentHost/common/arniApi.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { IAgentHostEnablementService } from '../../../../../../platform/agentHost/common/agentHostEnablementService.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../../../common/contributions.js';
import { ARNI_PRODUCT_AUTH_PROVIDERS, isArniProductAuthProvider } from '../../../../../services/authentication/common/arniProductAuth.js';
import { IAuthenticationService } from '../../../../../services/authentication/common/authentication.js';

/** Owns refresh and revocation independently of model-provider authentication. */
export class ArniWebSearchAuthContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.arniWebSearchAuth';
	private generation = 0;
	private readonly refresh = this._register(new RunOnceScheduler(() => { void this.publish(); }, 12 * 60 * 60 * 1000));

	constructor(
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IAgentHostService private readonly agentHostService: IAgentHostService,
		@IAgentHostEnablementService private readonly enablement: IAgentHostEnablementService,
		@ICommandService private readonly commandService: ICommandService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(toDisposable(() => { this.generation++; }));
		this._register(authenticationService.onDidChangeSessions(event => {
			if (isArniProductAuthProvider(event.providerId)) { void this.publish(); }
		}));
		this._register(authenticationService.onDidRegisterAuthenticationProvider(event => {
			if (isArniProductAuthProvider(event.id)) { void this.publish(); }
		}));
		this._register(agentHostService.onAgentHostStart(() => { void this.publish(); }));
		this._register(autorun(reader => {
			if (enablement.enabled.read(reader)) {
				void this.publish();
			} else {
				this.generation++;
				this.refresh.cancel();
			}
		}));
	}

	private async publish(): Promise<void> {
		const generation = ++this.generation;
		if (!this.enablement.enabled.get()) { return; }
		this.refresh.schedule();
		try {
			await publishArniWebSearchToken(this.authenticationService, this.agentHostService, this.logService,
				(provider, token) => this.commandService.executeCommand<IArniSessionExchangeResult>(ARNI_EXCHANGE_WEB_SEARCH_SESSION_COMMAND, provider, token),
				() => generation === this.generation);
		} catch {
			this.logService.warn('[AgentHost] Could not refresh the Arni web search session.');
			if (generation === this.generation) { this.refresh.schedule(30_000); }
		}
	}
}

/**
 * Exchanges the signed-in Yandex, VK or Google session for an Arni API token
 * and forwards it to the Agent Host. The host uses it only to call web search.
 * The Exa key stays on the API.
 */
export async function publishArniWebSearchToken(
	authenticationService: Pick<IAuthenticationService, 'getSessions'>,
	agentHostService: Pick<IAgentHostService, 'authenticate'>,
	logService: Pick<ILogService, 'warn'>,
	exchange: (provider: string, accessToken: string) => Promise<IArniSessionExchangeResult | undefined>,
	isCurrent: () => boolean = () => true,
): Promise<void> {
	if (!isCurrent()) { return; }
	let sawSession = false;
	for (const provider of ARNI_PRODUCT_AUTH_PROVIDERS) {
		let accessToken: string | undefined;
		try {
			accessToken = (await authenticationService.getSessions(provider.id))[0]?.accessToken;
		} catch {
			continue;
		}
		if (!isCurrent()) { return; }
		if (!accessToken) {
			continue;
		}
		sawSession = true;
		const result = await exchange(provider.id, accessToken);
		if (!isCurrent()) { return; }
		if (result?.token) {
			await agentHostService.authenticate({ resource: ARNI_API_RESOURCE, token: result.token });
			return;
		}
		logService.warn(`[AgentHost] Arni web search session exchange failed (${result?.status ?? 'unavailable'})`);
		// A server-side failure (5xx, rate limit) is the same for every provider, e.g. a database outage
		// that answers 500. Keep the JWT already stored and let the caller retry soon.
		if (!result || result.status >= 500 || result.status === 429) {
			throw new Error('Arni session exchange is unavailable.');
		}
	}
	if (!isCurrent() || sawSession) { return; }
	await agentHostService.authenticate({ resource: ARNI_API_RESOURCE, token: '' });
}

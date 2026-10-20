/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { getArniAgentIdentity } from '../../../../workbench/contrib/chat/common/arniAgentIdentity.js';
import { IChatModeService } from '../../../../workbench/contrib/chat/common/chatModes.js';
import { isAgentHostProvider } from '../../../common/agentHostSessionsProvider.js';
import { ISessionsProvidersService } from '../../../services/sessions/browser/sessionsProvidersService.js';
import { ISession } from '../../../services/sessions/common/session.js';

/** Resolve against the new workspace, and refuse to send under a different role. */
export async function selectStarterProfession(session: ISession, professionId: string, modesService: IChatModeService, providers: ISessionsProvidersService): Promise<void> {
	const store = new DisposableStore();
	try {
		const modes = store.add(modesService.createModes(session.resource));
		await modes.waitForPendingUpdates();
		const mode = modes.custom.find(candidate => candidate.visibility?.get()?.userInvocable !== false
			&& getArniAgentIdentity(candidate.name.get(), candidate.id)?.id === professionId);
		const provider = providers.getProvider(session.providerId);
		if (!mode || !provider || !(isAgentHostProvider(provider) ? provider.setAgent : provider.setMode)) {
			throw new Error(localize('starterProjects.professionUnavailable', "Специалист пока недоступен: {0}. Откройте выбор агентов и повторите запуск.", getArniAgentIdentity(professionId)?.name ?? professionId));
		}
		if (isAgentHostProvider(provider)) {
			provider.setAgent!(session.sessionId, { uri: mode.id, name: mode.name.get() });
		} else {
			provider.setMode!(session.sessionId, mode.id);
		}
		if (session.mode.get()?.id !== mode.id) {
			throw new Error(localize('starterProjects.professionNotSelected', "Не удалось выбрать специалиста. Задача не отправлена."));
		}
	} finally {
		store.dispose();
	}
}

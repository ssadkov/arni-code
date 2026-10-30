/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { constObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IChatMode, IChatModes, IChatModeService } from '../../../../../workbench/contrib/chat/common/chatModes.js';
import { IAgentHostSessionsProvider } from '../../../../common/agentHostSessionsProvider.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { ISession } from '../../../../services/sessions/common/session.js';
import { ISessionsProvider } from '../../../../services/sessions/common/sessionsProvider.js';
import { selectStarterProfession } from '../../browser/starterProfession.js';

suite('StarterProfession', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('agent-host drafts use setAgent rather than the legacy setMode API', async () => {
		const selected = observableValue<{ id: string; kind: string } | undefined>('mode', undefined);
		const mode = upcastPartial<IChatMode>({ id: 'file:///skills/programmer.agent.md', name: constObservable('Программист') });
		const modes = upcastPartial<IChatModes & { dispose(): void }>({ custom: [mode], waitForPendingUpdates: async () => { }, dispose() { } });
		const provider = upcastPartial<IAgentHostSessionsProvider>({ id: 'local-agent-host', setAgent: (sessionId, agent) => {
			assert.strictEqual(sessionId, 'draft');
			assert.deepStrictEqual(agent, { uri: mode.id, name: 'Программист' });
			selected.set({ id: agent!.uri, kind: 'agent' }, undefined);
		} });
		await selectStarterProfession(
			upcastPartial<ISession>({ sessionId: 'draft', providerId: provider.id, resource: URI.parse('agent-host-copilotcli:/draft'), mode: selected }),
			'programmer',
			upcastPartial<IChatModeService>({ createModes: () => modes }),
			upcastPartial<ISessionsProvidersService>({ getProvider: <T extends ISessionsProvider>() => provider as T }),
		);
		assert.strictEqual(selected.get()?.id, mode.id);
	});

	for (const refusal of ['none', 'missing', 'ignored'] as const) {
		test(`waits for workspace discovery, selects the real role or refuses: ${refusal}`, async () => {
			const calls: string[] = [];
			const selected = observableValue<{ id: string; kind: string } | undefined>('mode', undefined);
			const resource = URI.parse('vscode-chat-session:test');
			const target = upcastPartial<IChatMode>({ id: 'file:///skills/researcher.agent.md', name: constObservable('Исследователь') });
			let ready = false;
			const modes = upcastPartial<IChatModes & { dispose(): void }>({
				get custom() { assert.ok(ready); return refusal === 'missing' ? [] : [target]; },
				waitForPendingUpdates: async () => { calls.push('discover'); ready = true; },
				dispose: () => calls.push('dispose'),
			});
			const service = upcastPartial<IChatModeService>({ createModes: value => { assert.strictEqual(value, resource); return modes; } });
			const provider = upcastPartial<ISessionsProvider>({ id: 'local', setMode: (sessionId: string, id: string) => {
				assert.strictEqual(sessionId, 'draft');
				calls.push('select');
				if (refusal !== 'ignored') { selected.set({ id, kind: 'agent' }, undefined); }
			} });
			const providers = upcastPartial<ISessionsProvidersService>({ getProvider: <T extends ISessionsProvider>() => provider as T });
			const session = upcastPartial<ISession>({ resource, providerId: 'local', sessionId: 'draft', mode: selected });
			if (refusal === 'none') {
				await selectStarterProfession(session, 'researcher', service, providers);
				assert.strictEqual(selected.get()?.id, target.id);
				assert.deepStrictEqual(calls, ['discover', 'select', 'dispose']);
			} else {
				await assert.rejects(selectStarterProfession(session, 'researcher', service, providers));
				assert.strictEqual(calls.at(-1), 'dispose');
			}
		});
	}
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { upcastPartial } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ARNI_API_RESOURCE, IArniSessionExchangeResult } from '../../../../../../platform/agentHost/common/arniApi.js';
import { AuthenticateParams } from '../../../../../../platform/agentHost/common/agent.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { IAgentHostEnablementService } from '../../../../../../platform/agentHost/common/agentHostEnablementService.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { AuthenticationSession, IAuthenticationService } from '../../../../../services/authentication/common/authentication.js';
import { ArniWebSearchAuthContribution, publishArniWebSearchToken } from '../../../browser/agentSessions/agentHost/agentHostWebSearchAuth.js';

suite('Arni web search authentication', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const log = new NullLogService();
	const session: AuthenticationSession = { id: 'session', accessToken: 'oauth-token', scopes: [], account: { id: 'account', label: 'Account' } };

	test('authenticates when enabled and republishes after a host restart', async () => {
		const enabled = observableValue('enabled', false);
		const started = store.add(new Emitter<void>());
		const calls: AuthenticateParams[] = [];
		let exchanges = 0;
		store.add(new ArniWebSearchAuthContribution(
			upcastPartial<IAuthenticationService>({ getSessions: async id => id === 'yandex' ? [session] : [], onDidChangeSessions: Event.None, onDidRegisterAuthenticationProvider: Event.None }),
			upcastPartial<IAgentHostService>({ onAgentHostStart: started.event, authenticate: async params => { calls.push(params); return { authenticated: !!params.token }; } }),
			upcastPartial<IAgentHostEnablementService>({ enabled }),
			upcastPartial<ICommandService>({ executeCommand: async <T>() => { exchanges++; return { status: 200, token: 'arni-jwt' } as T; } }),
			log,
		));
		assert.strictEqual(calls.length, 0);
		enabled.set(true, undefined);
		await timeout(0);
		started.fire();
		await timeout(0);
		assert.deepStrictEqual({ tokens: calls.map(call => call.token), exchanges }, { tokens: ['arni-jwt', 'arni-jwt'], exchanges: 2 });
	});

	for (const provider of ['yandex', 'vk', 'google']) {
		test(`publishes only the exchanged ${provider} JWT to the host`, async () => {
			const calls: AuthenticateParams[] = [];
			const exchanges: string[][] = [];
			await publishArniWebSearchToken({ getSessions: async id => id === provider ? [session] : [] }, {
				authenticate: async params => { calls.push(params); return { authenticated: !!params.token }; },
			}, log, async (id, token) => { exchanges.push([id, token]); return { status: 200, token: 'arni-jwt' }; });
			assert.deepStrictEqual({ calls, exchanges }, {
				calls: [{ resource: ARNI_API_RESOURCE, token: 'arni-jwt' }],
				exchanges: [[provider, 'oauth-token']],
			});
		});
	}

	test('sign-out clears the host without exchanging anything', async () => {
		const calls: AuthenticateParams[] = [];
		await publishArniWebSearchToken({ getSessions: async () => [] }, {
			authenticate: async params => { calls.push(params); return { authenticated: false }; },
		}, log, async () => { throw new Error('Must not exchange without a session'); });
		assert.deepStrictEqual(calls, [{ resource: ARNI_API_RESOURCE, token: '' }]);
	});

	test('a late exchange cannot restore credentials after sign-out', async () => {
		const pending = new DeferredPromise<IArniSessionExchangeResult>();
		const started = new DeferredPromise<void>();
		const calls: AuthenticateParams[] = [];
		let current = true;
		const publishing = publishArniWebSearchToken({ getSessions: async () => [session] }, {
			authenticate: async params => { calls.push(params); return { authenticated: !!params.token }; },
		}, log, () => { started.complete(); return pending.p; }, () => current);
		await started.p;
		current = false;
		await pending.complete({ status: 200, token: 'stale-jwt' });
		await publishing;
		assert.deepStrictEqual(calls, []);
	});

	test('a rejected provider falls through to the next signed-in provider', async () => {
		const calls: AuthenticateParams[] = [];
		const exchanges: string[] = [];
		await publishArniWebSearchToken({
			getSessions: async id => id === 'yandex' || id === 'vk' ? [session] : [],
		}, {
			authenticate: async params => { calls.push(params); return { authenticated: !!params.token }; },
		}, log, async id => {
			exchanges.push(id);
			return id === 'vk' ? { status: 200, token: 'vk-jwt' } : { status: 401 };
		});
		assert.deepStrictEqual({ calls, exchanges }, {
			calls: [{ resource: ARNI_API_RESOURCE, token: 'vk-jwt' }],
			exchanges: ['yandex', 'vk'],
		});
	});

	test('a stale sign-in keeps the stored session when no other provider succeeds', async () => {
		const calls: AuthenticateParams[] = [];
		await publishArniWebSearchToken({ getSessions: async id => id === 'yandex' ? [session] : [] }, {
			authenticate: async params => { calls.push(params); return { authenticated: !!params.token }; },
		}, log, async () => ({ status: 401 }));
		assert.deepStrictEqual(calls, []);
	});

	test('an unavailable exchange keeps the stored session', async () => {
		const calls: AuthenticateParams[] = [];
		await assert.rejects(publishArniWebSearchToken({ getSessions: async id => id === 'yandex' ? [session] : [] }, {
			authenticate: async params => { calls.push(params); return { authenticated: !!params.token }; },
		}, log, async () => ({ status: 503 })), /unavailable/);
		assert.deepStrictEqual(calls, []);
	});

	test('a server error is retried like an outage, not treated as a rejected sign-in', async () => {
		// 2026-11-12: a database outage made the exchange answer 500 at startup, and search stayed signed out.
		const outcome = async (status: number) => publishArniWebSearchToken({ getSessions: async id => id === 'yandex' ? [session] : [] }, {
			authenticate: async params => ({ authenticated: !!params.token }),
		}, log, async () => ({ status })).then(() => 'settled', () => 'retry');
		assert.deepStrictEqual([await outcome(500), await outcome(429), await outcome(401)], ['retry', 'retry', 'settled']);
	});
});

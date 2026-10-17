/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { $, Dimension } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDefaultAccountService } from '../../../../../platform/defaultAccount/common/defaultAccount.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IEncryptionService, KnownStorageProvider } from '../../../../../platform/encryption/common/encryptionService.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { IEditorGroup } from '../../../../../workbench/services/editor/common/editorGroupsService.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../../../workbench/services/authentication/common/authentication.js';
import { IToolInvocation } from '../../../../../workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { parseArniProfile, selectArniProfileFields, validateArniProfile } from '../../common/arniUserProfile.js';
import { ArniUserProfileService } from '../../browser/arniUserProfileService.js';
import { ArniReadUserProfileTool } from '../../browser/arniUserProfileTools.js';
import { ArniUserProfileEditor, ArniUserProfileEditorInput } from '../../browser/arniUserProfileEditor.js';

suite('Arni personal card', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function setup() {
		let user: string | undefined = 'alice';
		let encryptionAvailable = true;
		let duringRead: (() => void) | undefined;
		const values = new Map<string, string>();
		const changes = store.add(new Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>());
		const authentication = new class extends mock<IAuthenticationService>() {
			override onDidChangeSessions = changes.event;
			override async getSessions(providerId: string): Promise<readonly AuthenticationSession[]> {
				return providerId === 'yandex' && user ? [{ id: 'session-' + user, account: { id: user, label: 'Same display name' }, accessToken: 'unused', scopes: [] }] : [];
			}
		};
		const defaults = new class extends mock<IDefaultAccountService>() { override async getDefaultAccount() { return null; } };
		const secrets = new class extends mock<ISecretStorageService>() {
			override async get(key: string) { const value = values.get(key); duringRead?.(); return value; }
			override async set(key: string, value: string) { values.set(key, value); }
			override async delete(key: string) { values.delete(key); }
		};
		const encryption = new class extends mock<IEncryptionService>() {
			override async isEncryptionAvailable() { return encryptionAvailable; }
			override async getKeyStorageProvider() { return KnownStorageProvider.dplib; }
		};
		const profiles = store.add(new ArniUserProfileService(authentication, defaults, secrets, encryption));
		return { profiles, authentication, values,
			switchUser: (next: string | undefined) => { user = next; changes.fire({ providerId: 'yandex', label: 'Yandex', event: { added: [], removed: [], changed: [] } }); },
			setEncryption: (enabled: boolean) => { encryptionAvailable = enabled; },
			duringRead: (callback: () => void) => { duringRead = callback; },
		};
	}

	test('keeps leading zeros and rejects unsupported fields, malformed values and schema versions', () => {
		assert.deepStrictEqual(validateArniProfile({ companyBin: '001234567890', phone: '+7 000 000 00 00', firstName: ' Test ' }), { companyBin: '001234567890', phone: '+7 000 000 00 00', firstName: 'Test' });
		for (const value of ['{"schemaVersion":2,"values":{}}', '{"schemaVersion":1,"values":{"password":"secret"}}', '{"schemaVersion":1,"values":{"companyBin":123}}', '{"schemaVersion":1,"values":{"email":"invalid"}}', '{"schemaVersion":1,"values":null}']) {
			assert.throws(() => parseArniProfile(value));
		}
		assert.throws(() => selectArniProfileFields({}, []));
	});

	test('isolates accounts with the same label, persists across service reads, and clears only current card', async () => {
		const h = setup();
		const alice = await h.profiles.getAccount();
		await h.profiles.save(alice, { firstName: 'Alice', companyBin: '001234567890' });
		h.switchUser('bob');
		const bob = await h.profiles.getAccount();
		assert.deepStrictEqual((await h.profiles.read(bob)).values, {});
		await h.profiles.save(bob, { firstName: 'Bob' });
		await assert.rejects(h.profiles.save(alice, { firstName: 'stale' }));
		await h.profiles.clear(bob);
		h.switchUser('alice');
		assert.deepStrictEqual((await h.profiles.read(await h.profiles.getAccount())).values, { firstName: 'Alice', companyBin: '001234567890' });
	});

	test('rejects sign-out during an asynchronous read and does not fall back to plaintext saving', async () => {
		const h = setup();
		const account = await h.profiles.getAccount();
		h.setEncryption(false);
		await assert.rejects(h.profiles.save(account, { firstName: 'private' }));
		assert.strictEqual(h.values.size, 0);
		h.duringRead(() => h.switchUser(undefined));
		await assert.rejects(h.profiles.read(account));
	});

	test('normal form edits and saves without AI, survives reopening, and removes visible fields on sign-out', async () => {
		const h = setup();
		const root = mainWindow.document.body.appendChild($('div'));
		store.add(toDisposable(() => root.remove()));
		const group = new class extends mock<IEditorGroup>() { override id = 1; override windowId = mainWindow.vscodeWindowId; };
		const storage = store.add(new InMemoryStorageService());
		const editor = store.add(new ArniUserProfileEditor(group, NullTelemetryService, new TestThemeService(), storage, h.profiles, h.authentication, new class extends mock<IDialogService>() { }));
		editor.create(root);
		editor.layout(new Dimension(800, 900));
		const input = store.add(new ArniUserProfileEditorInput());
		await editor.setInput(input, undefined, {}, CancellationToken.None);
		const name = root.querySelector<HTMLInputElement>('#arni-profile-firstName')!;
		name.value = 'Alice';
		name.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		assert.strictEqual(input.isDirty(), true);
		assert.strictEqual(await input.save(), input);
		editor.clearInput();
		await editor.setInput(input, undefined, {}, CancellationToken.None);
		assert.strictEqual(name.value, 'Alice');
		h.switchUser(undefined);
		assert.deepStrictEqual({ value: name.value, disabled: name.disabled }, { value: '', disabled: true });
		editor.clearInput();
	});

	function invocation(fields = ['firstName']): IToolInvocation {
		return { callId: 'profile-test', toolId: 'arni_read_user_profile', context: undefined,
			parameters: { fields, purpose: 'Prepare approved registration draft', destination: 'https://forms.cloud.microsoft/example' } };
	}

	test('requires user review even for auto-approved invocation and releases only selected values', async () => {
		const h = setup();
		await h.profiles.save(await h.profiles.getAccount(), { firstName: 'Alice', phone: '+70000000000' });
		let approve = false;
		let reviews = 0;
		const dialogs = new class extends mock<IDialogService>() {
			override async confirm() { reviews++; return { confirmed: approve }; }
		};
		const tool = new ArniReadUserProfileTool(h.profiles, dialogs, h.authentication);
		const denied = await tool.invoke(invocation(), async () => 0, { report() { } }, CancellationToken.None);
		assert.strictEqual(JSON.stringify(denied).includes('Alice'), false);
		approve = true;
		const approved = await tool.invoke(invocation(), async () => 0, { report() { } }, CancellationToken.None);
		assert.deepStrictEqual(JSON.parse(approved.content[0].kind === 'text' ? approved.content[0].value : '{}'), {
			status: 'approved', destination: 'https://forms.cloud.microsoft/example', values: { firstName: 'Alice' }, missingFields: [],
		});
		assert.strictEqual(reviews, 2);
	});

	test('withholds results if account changes during approval or cancellation is requested', async () => {
		const h = setup();
		await h.profiles.save(await h.profiles.getAccount(), { firstName: 'Alice' });
		const dialogs = new class extends mock<IDialogService>() {
			override async confirm() { h.switchUser('bob'); return { confirmed: true }; }
		};
		const result = await new ArniReadUserProfileTool(h.profiles, dialogs, h.authentication).invoke(invocation(), async () => 0, { report() { } }, CancellationToken.None);
		assert.strictEqual(JSON.stringify(result).includes('Alice'), false);
	});
});

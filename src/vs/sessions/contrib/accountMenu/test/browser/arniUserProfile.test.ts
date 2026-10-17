/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { $, Dimension } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDefaultAccountService } from '../../../../../platform/defaultAccount/common/defaultAccount.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IEncryptionService, KnownStorageProvider } from '../../../../../platform/encryption/common/encryptionService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { IEditorGroup } from '../../../../../workbench/services/editor/common/editorGroupsService.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../../../workbench/services/authentication/common/authentication.js';
import { ILanguageModelToolsService, IToolData, IToolInvocation, IToolResult, ToolSet } from '../../../../../workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { applyArniProfileUpdates, parseArniProfile, selectArniProfileEntries, selectArniProfileFields, validateArniCustomFields, validateArniProfile } from '../../common/arniUserProfile.js';
import { ArniUserProfileService, IArniUserProfileService } from '../../browser/arniUserProfileService.js';
import { ArniEditUserProfileTool, ArniReadUserProfileTool, ArniUserProfileTools } from '../../browser/arniUserProfileTools.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
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
		for (const value of ['{"schemaVersion":3,"values":{}}', '{"schemaVersion":1,"values":{"password":"secret"}}', '{"schemaVersion":1,"values":{"companyBin":123}}', '{"schemaVersion":1,"values":{"email":"invalid"}}', '{"schemaVersion":1,"values":null}']) {
			assert.throws(() => parseArniProfile(value));
		}
		assert.throws(() => selectArniProfileFields({}, []));
	});

	test('migrates legacy cards and validates custom field IDs, labels and bounded values', () => {
		const legacy = parseArniProfile('{"schemaVersion":1,"values":{"firstName":"Alice","companyBin":"001234567890"}}');
		const updated = applyArniProfileUpdates(legacy, [{ field: 'custom_telegram', label: 'Telegram', value: '@example' }]);
		assert.deepStrictEqual(parseArniProfile(JSON.stringify(updated)), {
			schemaVersion: 2, values: legacy.values, customFields: [{ id: 'custom_telegram', label: 'Telegram', value: '@example' }],
		});
		for (const fields of [
			[{ id: '__proto__', label: 'Unsafe', value: 'x' }],
			[{ id: 'custom_x', label: 'Имя', value: 'x' }],
			[{ id: 'custom_x', label: 'Telegram', value: 'x' }, { id: 'custom_y', label: 'telegram', value: 'y' }],
			[{ id: 'custom_x', label: 'Telegram', value: 'x'.repeat(2001) }],
		]) { assert.throws(() => validateArniCustomFields(fields)); }
		assert.throws(() => applyArniProfileUpdates(updated, [{ field: 'custom_no_label', value: 'x' }]));
		assert.deepStrictEqual(selectArniProfileEntries(updated, ['Telegram']).entries, updated.customFields);
		assert.deepStrictEqual(applyArniProfileUpdates(updated, [{ field: 'custom_telegram', value: null }]).customFields, []);
	});

	test('preserves custom fields on base-only saves and refuses stale concurrent writes', async () => {
		const h = setup();
		const account = await h.profiles.getAccount();
		await h.profiles.save(account, { firstName: 'Alice' }, [{ id: 'custom_x', label: 'Extra', value: 'kept' }]);
		const previous = await h.profiles.read(account);
		await h.profiles.save(account, { firstName: 'New name' });
		await assert.rejects(h.profiles.save(account, { firstName: 'Stale' }, [], previous));
		assert.deepStrictEqual(await h.profiles.read(account), { schemaVersion: 2, values: { firstName: 'New name' }, customFields: previous.customFields });
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
		const add = [...root.querySelectorAll<HTMLElement>('.monaco-button')].find(button => button.textContent === 'Добавить поле')!;
		add.click();
		const label = root.querySelector<HTMLInputElement>('.arni-profile-custom-row input[id$="-label"]')!;
		const customValue = root.querySelector<HTMLInputElement>('.arni-profile-custom-row input[id$="-value"]')!;
		label.value = 'Telegram';
		customValue.value = '@example';
		customValue.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		assert.strictEqual(input.isDirty(), true);
		assert.strictEqual(await input.save(), input);
		editor.clearInput();
		await editor.setInput(input, undefined, {}, CancellationToken.None);
		assert.strictEqual(name.value, 'Alice');
		assert.strictEqual(root.querySelector<HTMLInputElement>('.arni-profile-custom-row input[id$="-value"]')!.value, '@example');
		const renamed = root.querySelector<HTMLInputElement>('.arni-profile-custom-row input[id$="-label"]')!;
		const stableId = renamed.id;
		renamed.value = 'Рабочий Telegram';
		renamed.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		assert.strictEqual(await input.save(), input);
		assert.strictEqual(await input.save(), input); // Saving an unchanged form must not reload it mid-save.
		editor.clearInput();
		await editor.setInput(input, undefined, {}, CancellationToken.None);
		assert.deepStrictEqual({ id: root.querySelector<HTMLInputElement>('.arni-profile-custom-row input[id$="-label"]')!.id, label: root.querySelector<HTMLInputElement>('.arni-profile-custom-row input[id$="-label"]')!.value }, { id: stableId, label: 'Рабочий Telegram' });
		name.value = 'Unsaved';
		name.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		await h.profiles.save(await h.profiles.getAccount(), { firstName: 'AI update' });
		assert.strictEqual(await input.save(), undefined);
		assert.strictEqual((await h.profiles.read(await h.profiles.getAccount())).values.firstName, 'AI update');
		editor.clearInput();
		await editor.setInput(input, undefined, {}, CancellationToken.None);
		[...root.querySelectorAll<HTMLElement>('.arni-profile-custom-row .monaco-button')][0].click();
		await input.save();
		assert.deepStrictEqual((await h.profiles.read(await h.profiles.getAccount())).customFields, []);
		h.switchUser(undefined);
		assert.deepStrictEqual({ value: name.value, disabled: name.disabled }, { value: '', disabled: true });
		editor.clearInput();
	});

	function invocation(fields = ['firstName']): IToolInvocation {
		return { callId: 'profile-test', toolId: 'arni_read_user_profile', context: undefined,
			parameters: { fields, purpose: 'Prepare approved registration draft', destination: 'https://forms.cloud.microsoft/example' } };
	}

	test('exposes both card tools through a non-deprecated tool set available to the agent', () => {
		const h = setup();
		const registered = new Map<string, IToolData>();
		const sets = new Set<ToolSet>();
		const tools = new class extends mock<ILanguageModelToolsService>() {
			override registerTool(data: IToolData) {
				registered.set(data.id, data);
				return toDisposable(() => registered.delete(data.id));
			}
			override createToolSet(...[source, id, referenceName, options = {}]: Parameters<ILanguageModelToolsService['createToolSet']>) {
				const context = new class extends MockContextKeyService {
					override contextMatchesRules(rules: ContextKeyExpression | undefined): boolean { return !rules; }
				};
				const set = new ToolSet(id, referenceName, options.icon ?? Codicon.tools, source, options.description, options.detail, options.legacyFullNames, options.deprecated, options.hiddenInToolsPicker, context);
				sets.add(set);
				return Object.assign(set, { dispose: () => { sets.delete(set); } });
			}
		};
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IArniUserProfileService, h.profiles);
		instantiation.stub(IAuthenticationService, h.authentication);
		instantiation.stub(IDialogService, {});
		instantiation.stub(ICommandService, {});
		const contribution = store.add(new ArniUserProfileTools(tools, instantiation));
		const activeSets = [...sets].filter(set => !set.deprecated);
		const available = activeSets.flatMap(set => [...set.getTools()]);
		assert.deepStrictEqual(available.map(tool => ({ id: tool.id, name: tool.toolReferenceName, registered: registered.get(tool.id) === tool })), [
			{ id: 'arni_read_user_profile', name: 'arniReadUserProfile', registered: true },
			{ id: 'arni_edit_user_profile', name: 'arniEditUserProfile', registered: true },
		]);
		contribution.dispose();
		assert.deepStrictEqual({ registrations: registered.size, toolSets: sets.size, members: activeSets.flatMap(set => [...set.getTools()]).length }, { registrations: 0, toolSets: 0, members: 0 });
	});

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
			status: 'approved', destination: 'https://forms.cloud.microsoft/example', values: { firstName: 'Alice' }, fieldLabels: { firstName: 'Имя' }, missingFields: [],
		});
		assert.strictEqual(reviews, 2);
	});

	function resultText(result: IToolResult): string { return result.content[0].kind === 'text' ? result.content[0].value : '{}'; }
	function editInvocation(): IToolInvocation {
		return { callId: 'edit-test', toolId: 'arni_edit_user_profile', context: undefined, parameters: {
			purpose: 'Save user-supplied contact', updates: [{ field: 'custom_telegram', label: 'Telegram', value: '@example' }],
		} };
	}

	test('AI can save partial updates and read custom fields or the whole card in chat without a website', async () => {
		const h = setup();
		await h.profiles.save(await h.profiles.getAccount(), { firstName: 'Alice', phone: '+70000000000' });
		const dialogs = new class extends mock<IDialogService>() { override async confirm() { return { confirmed: true }; } };
		const edited = await new ArniEditUserProfileTool(new class extends mock<ICommandService>() { }, h.profiles, dialogs, h.authentication).invoke(editInvocation(), async () => 0, { report() { } }, CancellationToken.None);
		assert.deepStrictEqual(JSON.parse(resultText(edited)), { status: 'saved', updatedFields: ['custom_telegram'] });
		const reader = new ArniReadUserProfileTool(h.profiles, dialogs, h.authentication);
		const chatRequest = { ...invocation(), parameters: { purpose: 'Show my Telegram', fields: ['Telegram'] } };
		assert.deepStrictEqual(JSON.parse(resultText(await reader.invoke(chatRequest, async () => 0, { report() { } }, CancellationToken.None))), {
			status: 'approved', values: { custom_telegram: '@example' }, fieldLabels: { custom_telegram: 'Telegram' }, missingFields: [],
		});
		const all = JSON.parse(resultText(await reader.invoke({ ...invocation(), parameters: { purpose: 'Show my card' } }, async () => 0, { report() { } }, CancellationToken.None)));
		assert.deepStrictEqual(all.values, { firstName: 'Alice', phone: '+70000000000', custom_telegram: '@example' });
		const editor = new ArniEditUserProfileTool(new class extends mock<ICommandService>() { }, h.profiles, dialogs, h.authentication);
		await editor.invoke({ ...editInvocation(), parameters: { purpose: 'Correct my contacts', updates: [{ field: 'custom_telegram', label: 'Рабочий Telegram', value: '@changed' }, { field: 'phone', value: null }] } }, async () => 0, { report() { } }, CancellationToken.None);
		const changed = await h.profiles.read(await h.profiles.getAccount());
		assert.deepStrictEqual({ values: changed.values, customFields: changed.customFields }, { values: { firstName: 'Alice' }, customFields: [{ id: 'custom_telegram', label: 'Рабочий Telegram', value: '@changed' }] });
		await editor.invoke({ ...editInvocation(), parameters: { purpose: 'Remove my custom contact', updates: [{ field: 'custom_telegram', value: null }] } }, async () => 0, { report() { } }, CancellationToken.None);
		assert.deepStrictEqual((await h.profiles.read(await h.profiles.getAccount())).customFields, []);
	});

	test('AI can discover an empty custom field ID after review and fill it without creating a duplicate', async () => {
		const h = setup();
		await h.profiles.save(await h.profiles.getAccount(), {}, [{ id: 'custom_from_form', label: 'Telegram', value: '' }]);
		const dialogs = new class extends mock<IDialogService>() { override async confirm() { return { confirmed: true }; } };
		const response = await new ArniReadUserProfileTool(h.profiles, dialogs, h.authentication).invoke({ ...invocation(), parameters: { purpose: 'Fill my existing Telegram field', fields: ['Telegram'] } }, async () => 0, { report() { } }, CancellationToken.None);
		assert.deepStrictEqual(JSON.parse(resultText(response)), { status: 'approved', values: {}, fieldLabels: { custom_from_form: 'Telegram' }, missingFields: ['Telegram'] });
		await new ArniEditUserProfileTool(new class extends mock<ICommandService>() { }, h.profiles, dialogs, h.authentication).invoke({ ...editInvocation(), parameters: { purpose: 'Fill the existing field', updates: [{ field: 'custom_from_form', value: '@example' }] } }, async () => 0, { report() { } }, CancellationToken.None);
		assert.deepStrictEqual((await h.profiles.read(await h.profiles.getAccount())).customFields, [{ id: 'custom_from_form', label: 'Telegram', value: '@example' }]);
	});

	test('AI edit refusal, cancellation and sign-out do not modify storage or disclose previous values', async () => {
		for (const mode of ['deny', 'cancel', 'account'] as const) {
			const h = setup();
			await h.profiles.save(await h.profiles.getAccount(), { firstName: 'Private previous value' });
			const previous = [...h.values];
			const cancellation = store.add(new CancellationTokenSource());
			const dialogs = new class extends mock<IDialogService>() {
				override async confirm() {
					if (mode === 'cancel') { cancellation.cancel(); }
					if (mode === 'account') { h.switchUser('bob'); }
					return { confirmed: mode !== 'deny' };
				}
			};
			const result = await new ArniEditUserProfileTool(new class extends mock<ICommandService>() { }, h.profiles, dialogs, h.authentication).invoke(editInvocation(), async () => 0, { report() { } }, cancellation.token);
			assert.deepStrictEqual({ response: JSON.parse(resultText(result)), storage: [...h.values] }, { response: { status: 'denied' }, storage: previous });
		}
	});

	test('AI edit does not overwrite a card changed while the review was open', async () => {
		const h = setup();
		await h.profiles.save(await h.profiles.getAccount(), { firstName: 'Alice' });
		const dialogs = new class extends mock<IDialogService>() {
			override async confirm() { await h.profiles.save(await h.profiles.getAccount(), { firstName: 'User correction' }); return { confirmed: true }; }
		};
		const response = await new ArniEditUserProfileTool(new class extends mock<ICommandService>() { }, h.profiles, dialogs, h.authentication).invoke(editInvocation(), async () => 0, { report() { } }, CancellationToken.None);
		assert.strictEqual(JSON.parse(resultText(response)).status, 'unavailable');
		assert.deepStrictEqual((await h.profiles.read(await h.profiles.getAccount())).values, { firstName: 'User correction' });
		assert.deepStrictEqual((await h.profiles.read(await h.profiles.getAccount())).customFields, []);
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

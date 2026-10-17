/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/arniUserProfile.css';
import { $, append, Dimension } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { defaultButtonStyles, defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { EditorPane } from '../../../../workbench/browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../workbench/common/editor/editorInput.js';
import { EditorInputCapabilities, IEditorOpenContext, IUntypedEditorInput } from '../../../../workbench/common/editor.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IEditorGroup } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { arniProfileFields, ArniProfileField, ArniProfileValues, validateArniProfile } from '../common/arniUserProfile.js';
import { IArniProfileAccount, IArniUserProfileService } from './arniUserProfileService.js';

export class ArniUserProfileEditorInput extends EditorInput {
	static readonly ID = 'arni.personalCard.input';
	override readonly resource = undefined;
	private dirty = false;
	saveHandler: (() => Promise<boolean>) | undefined;
	revertHandler: (() => Promise<void>) | undefined;
	override get typeId(): string { return ArniUserProfileEditorInput.ID; }
	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Singleton; }
	override getName(): string { return localize('arni.profile.title', 'Мои данные'); }
	override isDirty(): boolean { return this.dirty; }
	setDirty(value: boolean): void {
		if (this.dirty !== value) { this.dirty = value; this._onDidChangeDirty.fire(); }
	}
	override async save(): Promise<EditorInput | undefined> { return await this.saveHandler?.() ? this : undefined; }
	override async revert(): Promise<void> { await this.revertHandler?.(); }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof ArniUserProfileEditorInput; }
}

/** A regular editable form: no prompts, model calls or workspace files. */
export class ArniUserProfileEditor extends EditorPane {
	static readonly ID = 'arni.personalCard.editor';
	private container: HTMLElement | undefined;
	private heading: HTMLElement | undefined;
	private status: HTMLElement | undefined;
	private readonly fields = new Map<ArniProfileField, InputBox>();
	private readonly formResources = this._register(new DisposableStore());
	private saveButton: Button | undefined;
	private clearButton: Button | undefined;
	private account: IArniProfileAccount | undefined;
	private request = 0;
	private loading = false;

	constructor(group: IEditorGroup,
		@ITelemetryService telemetry: ITelemetryService,
		@IThemeService theme: IThemeService,
		@IStorageService storage: IStorageService,
		@IArniUserProfileService private readonly profiles: IArniUserProfileService,
		@IAuthenticationService authentication: IAuthenticationService,
		@IDialogService private readonly dialogs: IDialogService,
	) {
		super(ArniUserProfileEditor.ID, group, telemetry, theme, storage);
		this._register(authentication.onDidChangeSessions(() => { void this.load(); }));
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('.arni-personal-card'));
		append(this.container, $('h1')).textContent = localize('arni.profile.title', 'Мои данные');
		this.heading = append(this.container, $('p.arni-profile-account'));
		append(this.container, $('p')).textContent = localize('arni.profile.local', 'Карточка хранится локально для вашего аккаунта. AI не нужен для просмотра и редактирования. Доступ модели к выбранным полям подтверждается отдельно. Синхронизации между компьютерами пока нет.');
		const sections = {
			person: localize('arni.profile.person', 'Обо мне'),
			contacts: localize('arni.profile.contacts', 'Контакты'),
			company: localize('arni.profile.company', 'Организация'),
		};
		for (const section of ['person', 'contacts', 'company'] as const) {
			const fieldset = append(this.container, $('fieldset'));
			append(fieldset, $('legend')).textContent = sections[section];
			for (const field of arniProfileFields.filter(field => field.section === section)) {
				const row = append(fieldset, $('.arni-profile-row'));
				const label = append(row, $('label'));
				label.textContent = field.label;
				const input = this.formResources.add(new InputBox(row, undefined, { inputBoxStyles: defaultInputBoxStyles, ariaLabel: field.label }));
				input.inputElement.id = `arni-profile-${field.key}`;
				input.inputElement.maxLength = field.key === 'bio' ? 2000 : 250;
				input.inputElement.autocomplete = 'off';
				label.setAttribute('for', input.inputElement.id);
				this.fields.set(field.key, input);
				this.formResources.add(input.onDidChange(() => { if (!this.loading) { this.profileInput?.setDirty(true); } }));
			}
		}
		this.status = append(this.container, $('p.arni-profile-status', { role: 'status', 'aria-live': 'polite' }));
		const buttons = append(this.container, $('.arni-profile-buttons'));
		this.saveButton = this.formResources.add(new Button(buttons, { ...defaultButtonStyles }));
		this.saveButton.label = localize('arni.profile.save', 'Сохранить');
		this.formResources.add(this.saveButton.onDidClick(() => { void this.saveProfile(); }));
		this.clearButton = this.formResources.add(new Button(buttons, { ...defaultButtonStyles, secondary: true }));
		this.clearButton.label = localize('arni.profile.clear', 'Очистить карточку');
		this.formResources.add(this.clearButton.onDidClick(() => { void this.clearProfile(); }));
		this.enable(false);
	}

	private get profileInput(): ArniUserProfileEditorInput | undefined { return this.input instanceof ArniUserProfileEditorInput ? this.input : undefined; }

	override async setInput(input: ArniUserProfileEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		input.saveHandler = () => this.saveProfile();
		input.revertHandler = () => this.load();
		await this.load();
	}

	override clearInput(): void {
		if (this.profileInput) { this.profileInput.saveHandler = undefined; this.profileInput.revertHandler = undefined; }
		this.request++;
		this.account = undefined;
		this.writeValues({});
		super.clearInput();
	}

	private enable(enabled: boolean): void {
		for (const input of this.fields.values()) { input.setEnabled(enabled); }
		if (this.saveButton) { this.saveButton.enabled = enabled; }
		if (this.clearButton) { this.clearButton.enabled = enabled; }
	}
	private writeValues(values: ArniProfileValues): void {
		this.loading = true;
		for (const [key, input] of this.fields) { input.value = values[key] ?? ''; }
		this.loading = false;
	}
	private showStatus(message: string): void { if (this.status) { this.status.textContent = message; } }

	private async load(): Promise<void> {
		const request = ++this.request;
		this.account = undefined;
		this.enable(false);
		this.writeValues({});
		this.profileInput?.setDirty(false);
		if (this.heading) { this.heading.textContent = ''; }
		if (!this.input) { return; }
		try {
			const account = await this.profiles.getAccount();
			const profile = await this.profiles.read(account);
			if (request !== this.request) { return; }
			this.account = account;
			this.writeValues(profile.values);
			if (this.heading) { this.heading.textContent = localize('arni.profile.account', 'Аккаунт: {0}', account.label); }
			this.showStatus(localize('arni.profile.optional', 'Все поля необязательны. Указывайте только сведения, которые хотите использовать в задачах.'));
			this.enable(true);
		} catch (error) {
			if (request === this.request) { this.showStatus(error instanceof Error ? error.message : localize('arni.profile.loadFailed', 'Не удалось открыть карточку.')); }
		}
	}

	private async saveProfile(): Promise<boolean> {
		const account = this.account;
		if (!account) { return false; }
		this.enable(false);
		try {
			const values: ArniProfileValues = {};
			for (const [key, input] of this.fields) { values[key] = input.value; }
			await this.profiles.save(account, validateArniProfile(values));
			if (account !== this.account) { return false; }
			this.profileInput?.setDirty(false);
			this.showStatus(localize('arni.profile.saved', 'Сохранено на этом компьютере. Данные не отправлены модели или в форму.'));
			return true;
		} catch (error) {
			if (account === this.account) { this.showStatus(error instanceof Error ? error.message : localize('arni.profile.saveFailed', 'Не удалось сохранить карточку.')); }
			return false;
		} finally { if (account === this.account) { this.enable(true); } }
	}

	private async clearProfile(): Promise<void> {
		const account = this.account;
		if (!account) { return; }
		const confirmation = await this.dialogs.confirm({ custom: true, message: localize('arni.profile.clearQuestion', 'Очистить карточку этого аккаунта на компьютере?'), detail: localize('arni.profile.clearDetail', 'Сохранённые поля будут удалены. Анкеты на сайтах и история чатов не изменятся.'), primaryButton: localize('arni.profile.clear', 'Очистить карточку') });
		if (!confirmation.confirmed) { return; }
		try { await this.profiles.clear(account); if (account === this.account) { await this.load(); } }
		catch (error) { if (account === this.account) { this.showStatus(error instanceof Error ? error.message : localize('arni.profile.clearFailed', 'Не удалось очистить карточку.')); } }
	}

	override layout(dimension: Dimension): void { if (this.container) { this.container.style.height = `${dimension.height}px`; } }
	override focus(): void { super.focus(); this.fields.get('firstName')?.focus(); }
}

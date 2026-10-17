/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { CountTokensCallback, ILanguageModelToolsService, IToolData, IToolImpl, IToolInvocation, IToolResult, ToolDataSource, ToolProgress } from '../../../../workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { applyArniProfileUpdates, arniCustomProfileFieldLimit, arniProfileEntries, arniProfileFields, IArniProfileUpdate, selectArniProfileEntries } from '../common/arniUserProfile.js';
import { IArniUserProfileService } from './arniUserProfileService.js';

const readTool: IToolData = {
	id: 'arni_read_user_profile', toolReferenceName: 'arniReadUserProfile',
	displayName: localize('arni.profile.readTool', 'Получить выбранные поля карточки'),
	modelDescription: 'Read My Data in chat or for an authorized website. Request field IDs or visible field labels (including custom fields); omit fields only when the user asks to see their whole card. Built-in IDs: ' + arniProfileFields.map(field => field.key).join(', ') + '. Optional destination is an exact HTTPS page URL. Shows user review before releasing values to the model. Returns values and fieldLabels keyed by stable IDs. Missing values are not guessed. Never submit a form or accept terms based on this approval.',
	source: ToolDataSource.Internal,
	inputSchema: { type: 'object', properties: {
		fields: { type: 'array', description: 'Field IDs or unique visible labels. Omit to show the whole card when requested by the user.', items: { type: 'string', minLength: 1, maxLength: 100 }, minItems: 1, maxItems: arniProfileFields.length + arniCustomProfileFieldLimit, uniqueItems: true },
		purpose: { type: 'string', minLength: 1, maxLength: 500 },
		destination: { type: 'string', description: 'Exact HTTPS form/page URL that the user asked to use. No credentials in the URL.' },
	}, required: ['purpose'], additionalProperties: false },
};

const editTool: IToolData = {
	id: 'arni_edit_user_profile', toolReferenceName: 'arniEditUserProfile',
	displayName: localize('arni.profile.editTool', 'Изменить «Мои данные»'),
	modelDescription: 'Edit the account-bound My Data card at the user request. Without updates, opens the normal form. With updates and purpose, proposes a partial change and saves after showing the user the before/after review. Use existing IDs from arniReadUserProfile; new custom fields require a unique lowercase custom_ ID and label. value:null clears a built-in value or deletes a custom field. Does not return previous personal values. Do not infer facts or replace unrelated fields. Do not access card files or secret storage through shell.',
	source: ToolDataSource.Internal, inputSchema: { type: 'object', properties: {
		purpose: { type: 'string', minLength: 1, maxLength: 500 },
		updates: { type: 'array', minItems: 1, maxItems: arniProfileFields.length + arniCustomProfileFieldLimit, items: {
			type: 'object', properties: {
				field: { type: 'string', description: 'Built-in ID, existing custom ID, or a new custom_ ID matching ^custom_[a-z0-9][a-z0-9_-]{0,63}$.' },
				label: { type: 'string', maxLength: 80, description: 'Required for creating custom fields; optional to rename existing custom fields. Omit for built-ins.' },
				value: { type: ['string', 'null'], maxLength: 2000 },
			}, required: ['field', 'value'], additionalProperties: false,
		} },
	}, additionalProperties: false },
};

/** The review is inside invocation, so chat-wide tool auto-approval cannot bypass it. */
export class ArniReadUserProfileTool implements IToolImpl {
	constructor(
		@IArniUserProfileService private readonly profiles: IArniUserProfileService,
		@IDialogService private readonly dialogs: IDialogService,
		@IAuthenticationService private readonly authentication: IAuthenticationService,
	) { }

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const resources = new DisposableStore();
		try {
			if (token.isCancellationRequested) { return this.result({ status: 'denied' }); }
			const fields = invocation.parameters.fields as string[] | undefined;
			const purpose = invocation.parameters.purpose;
			const destination = invocation.parameters.destination;
			if (typeof purpose !== 'string' || !purpose.trim() || purpose.length > 500 || (destination !== undefined && (typeof destination !== 'string' || destination.length > 2000))) { throw new Error('Invalid profile request'); }
			const url = destination === undefined ? undefined : new URL(destination);
			if (url && (url.protocol !== 'https:' || url.username || url.password)) { throw new Error('Expected an HTTPS destination without credentials'); }
			const account = await this.profiles.getAccount();
			const profile = await this.profiles.read(account);
			const selected = selectArniProfileEntries(profile, fields);
			if (!selected.entries.some(field => field.value)) { return this.result({ status: 'missing', missingFields: selected.missingFields, instruction: 'Ask the user for missing values; use arniEditUserProfile to save user-supplied updates or open My Data. Do not guess values.' }); }
			const cancellation = resources.add(new CancellationTokenSource(token));
			resources.add(this.authentication.onDidChangeSessions(() => cancellation.cancel()));
			const lines = selected.entries.map(field => `${field.label}: ${field.value || localize('arni.profile.missing', 'не заполнено')}`);
			const confirmation = await this.dialogs.confirm({
				custom: true, token: cancellation.token,
				message: localize('arni.profile.reviewTitle', 'Передать выбранные поля карточки модели?'),
				detail: localize('arni.profile.reviewDetail', 'Аккаунт: {0}\nЗадача: {1}\nПолучатель формы: {2}\nМодель: {3}\n\n{4}\n\nЭти сведения попадут в контекст чата и могут сохраниться в его истории. Разрешение не отправляет форму и не принимает условия сайта.', account.label, purpose, url?.href ?? localize('arni.profile.chatOnly', 'нет — просмотр в текущем чате'), invocation.modelId ?? localize('arni.profile.currentModel', 'выбранная в чате'), lines.join('\n')),
				primaryButton: localize('arni.profile.share', 'Передать эти поля'),
				cancelButton: localize('arni.profile.doNotShare', 'Не передавать'),
			});
			if (!confirmation.confirmed || cancellation.token.isCancellationRequested) { return this.result({ status: 'denied' }); }
			const latest = selectArniProfileEntries(await this.profiles.read(account), fields);
			if (JSON.stringify(latest) !== JSON.stringify(selected)) { return this.result({ status: 'changed', instruction: 'Card changed during review. Ask the user before making a new request.' }); }
			if (cancellation.token.isCancellationRequested) { return this.result({ status: 'denied' }); }
			return this.result({ status: 'approved', ...(url ? { destination: url.href } : {}),
				values: Object.fromEntries(selected.entries.filter(field => field.value).map(field => [field.id, field.value])),
				fieldLabels: Object.fromEntries(selected.entries.map(field => [field.id, field.label])), missingFields: selected.missingFields });
		} catch {
			return this.result({ status: 'unavailable', instruction: 'Open My Data and check sign-in, fields and destination. No values were disclosed.' });
		} finally { resources.dispose(); }
	}

	private result(value: object): IToolResult { return { content: [{ kind: 'text', value: JSON.stringify(value) }] }; }
}

export class ArniEditUserProfileTool implements IToolImpl {
	constructor(
		@ICommandService private readonly commands: ICommandService,
		@IArniUserProfileService private readonly profiles: IArniUserProfileService,
		@IDialogService private readonly dialogs: IDialogService,
		@IAuthenticationService private readonly authentication: IAuthenticationService,
	) { }
	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const result = (value: object): IToolResult => ({ content: [{ kind: 'text', value: JSON.stringify(value) }] });
		const resources = new DisposableStore();
		try {
			if (token.isCancellationRequested) { return result({ status: 'denied' }); }
			if (invocation.parameters.updates === undefined) {
				await this.commands.executeCommand('arni.openUserProfile');
				return result({ status: 'opened', instruction: 'My Data is open. No values have been read or changed by this tool. Wait for the user to save and reply.' });
			}
			const purpose = invocation.parameters.purpose;
			if (typeof purpose !== 'string' || !purpose.trim() || purpose.length > 500) { throw new Error('State the purpose of this update'); }
			const updates = invocation.parameters.updates as IArniProfileUpdate[];
			const account = await this.profiles.getAccount();
			const previous = await this.profiles.read(account);
			const next = applyArniProfileUpdates(previous, updates);
			const cancellation = resources.add(new CancellationTokenSource(token));
			resources.add(this.authentication.onDidChangeSessions(() => cancellation.cancel()));
			const before = arniProfileEntries(previous);
			const after = arniProfileEntries(next);
			const empty = localize('arni.profile.empty', 'не заполнено');
			const lines = updates.map(update => {
				const old = before.find(field => field.id === update.field);
				const changed = after.find(field => field.id === update.field);
				return `${old?.label ?? changed?.label ?? update.field}: ${old?.value || empty} → ${changed ? `${changed.label}: ${changed.value || empty}` : localize('arni.profile.removed', 'поле удалено')}`;
			});
			const review = await this.dialogs.confirm({ custom: true, token: cancellation.token,
				message: localize('arni.profile.editReview', 'Сохранить изменения карточки от AI?'),
				detail: localize('arni.profile.editReviewDetail', 'Аккаунт: {0}\nЗадача: {1}\nМодель: {2}\n\n{3}\n\nБудут изменены только перечисленные поля. Прежние значения не возвращаются модели. Это не отправка анкеты.', account.label, purpose, invocation.modelId ?? localize('arni.profile.currentModel', 'выбранная в чате'), lines.join('\n')),
				primaryButton: localize('arni.profile.applyChanges', 'Сохранить изменения'), cancelButton: localize('arni.profile.cancelChanges', 'Не менять'),
			});
			if (!review.confirmed || cancellation.token.isCancellationRequested) { return result({ status: 'denied' }); }
			await this.profiles.save(account, next.values, next.customFields, previous, cancellation.token);
			return result({ status: 'saved', updatedFields: updates.map(update => update.field) });
		} catch {
			return result({ status: 'unavailable', instruction: 'No previous values were disclosed. Check update IDs/labels, sign-in and whether the card changed during review; do not retry after refusal.' });
		} finally { resources.dispose(); }
	}
}

export class ArniUserProfileTools extends Disposable {
	static readonly ID = 'arni.personalCard.tools';
	constructor(@ILanguageModelToolsService tools: ILanguageModelToolsService, @IInstantiationService instantiation: IInstantiationService) {
		super();
		const toolSet = this._register(tools.createToolSet(ToolDataSource.Internal, 'arni-personal-card', 'arniPersonalCard', {
			icon: Codicon.account,
			description: localize('arni.profile.toolSet', 'Мои данные'),
			detail: localize('arni.profile.toolSetDetail', 'Просмотреть карточку, добавить свои поля или сохранить изменения от AI с проверкой.'),
		}));
		this._register(tools.registerTool(readTool, instantiation.createInstance(ArniReadUserProfileTool)));
		this._register(tools.registerTool(editTool, instantiation.createInstance(ArniEditUserProfileTool)));
		this._register(toolSet.addTool(readTool));
		this._register(toolSet.addTool(editTool));
	}
}
registerWorkbenchContribution2(ArniUserProfileTools.ID, ArniUserProfileTools, WorkbenchPhase.AfterRestored);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { disposableTimeout, raceCancellation } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { LRUCache } from '../../../../base/common/map.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfirmation, IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { CountTokensCallback, ILanguageModelToolsService, IToolData, IToolImpl, IToolInvocation, IToolResult, ToolDataSource, ToolProgress } from '../../../../workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { applyArniProfileUpdates, arniCustomProfileFieldLimit, arniProfileEntries, arniProfileFields, IArniProfileUpdate, selectArniProfileEntries } from '../common/arniUserProfile.js';
import { IArniUserProfileService } from './arniUserProfileService.js';

const readTool: IToolData = {
	id: 'arni_read_user_profile', toolReferenceName: 'arniReadUserProfile',
	displayName: localize('arni.profile.readTool', 'Получить выбранные поля карточки'),
	modelDescription: 'Read only My Data fields needed for the observed form, after user review. Do not copy the built-in field list into a request. For founder name/Telegram/X/proof of work request firstName,lastName,telegram,twitter,bio; do not request phone, address, company or email unless the form asks for them. Logical telegram/twitter aliases select a unique matching custom contact label; ambiguous/missing contacts are reported missing, never guessed. IDs and exact visible labels also work. If another custom field name is unknown, use metadataOnly:true to review names without values. Omitting fields does NOT read the whole card. Use allFields:true only when the user explicitly asks for the entire card. Built-in IDs: ' + arniProfileFields.map(field => field.key).join(', ') + '. Include destination with the exact HTTPS form URL. Tell the user in Russian to review the Arni confirmation before invoking; the tool waits up to two minutes. Approval does not submit the form or accept terms.',
	source: ToolDataSource.Internal,
	inputSchema: { type: 'object', properties: {
		fields: { type: 'array', description: 'Only the requested field IDs or exact visible labels. For a passport query, request only its field, never the whole card.', items: { type: 'string', minLength: 1, maxLength: 100 }, minItems: 1, maxItems: arniProfileFields.length + arniCustomProfileFieldLimit, uniqueItems: true },
		metadataOnly: { type: 'boolean', description: 'Review and return field IDs/labels only, without values. Use to discover a custom field name. Cannot be combined with fields/allFields.' },
		allFields: { type: 'boolean', description: 'Explicit full-card request, only when the user asked to see their entire card. Cannot be combined with fields/metadataOnly.' },
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

type ReviewStatus = 'approved' | 'denied' | 'approval_timeout' | 'awaiting_user' | 'retry_blocked';

/** Bound review waits below the SDK timeout and prevent automated re-prompts in one user turn. */
class ProfileReviewGuard {
	private readonly states = new LRUCache<string, ReviewStatus>(100);

	async confirm(invocation: IToolInvocation, dialogs: IDialogService, confirmation: IConfirmation, token: CancellationToken, progress: ToolProgress, notifications?: INotificationService): Promise<ReviewStatus> {
		const scope = JSON.stringify([invocation.context?.sessionResource.toString(), invocation.chatRequestId ?? invocation.callId]);
		const previous = this.states.get(scope);
		if (previous) {
			return previous === 'awaiting_user' ? 'awaiting_user' : 'retry_blocked';
		}
		this.states.set(scope, 'awaiting_user');
		const resources = new DisposableStore();
		const cancellation = resources.add(new CancellationTokenSource(token));
		let expired = false;
		const notice = notifications?.notify({ severity: Severity.Info, message: localize('arni.profile.reviewNotice', 'Нужно подтверждение «Моих данных» в окне Arni. Проверьте выбранные поля и нажмите «Передать эти поля». Через две минуты ожидание завершится.'), sticky: true });
		resources.add(disposableTimeout(() => { expired = true; cancellation.cancel(); }, 120_000));
		try {
			progress.report({ message: localize('arni.profile.waitingForReview', 'Ожидается ваше подтверждение в окне карточки данных. Через две минуты запрос остановится без передачи или сохранения данных.') });
			const answer = await raceCancellation(dialogs.confirm({ ...confirmation, custom: true, token: cancellation.token }), cancellation.token);
			const status = expired ? 'approval_timeout' : answer?.confirmed && !cancellation.token.isCancellationRequested ? 'approved' : 'denied';
			if (expired) { notifications?.info(localize('arni.profile.reviewTimeoutNotice', 'Подтверждение «Моих данных» не получено. Данные не переданы. Напишите агенту «Продолжи», чтобы запросить подтверждение снова.')); }
			if (status === 'approved') { this.states.delete(scope); } else { this.states.set(scope, status); }
			return status;
		} catch (error) {
			this.states.set(scope, 'denied');
			throw error;
		} finally { notice?.close(); resources.dispose(); }
	}
}

function reviewStopped(status: ReviewStatus): IToolResult {
	const response = status === 'denied' ? { status } : { status, instruction: 'Stop. No values were disclosed or saved. Explain that the card review is pending, was declined or expired. Wait for a new user message before requesting it again; do not repeat this call or guess the missing data.' };
	return { content: [{ kind: 'text', value: JSON.stringify(response) }], stopCurrentTurn: true,
		toolResultMessage: status === 'approval_timeout'
			? localize('arni.profile.reviewExpired', 'Остановлено: время подтверждения истекло, данные не переданы и не изменены')
			: localize('arni.profile.reviewStopped', 'Остановлено без передачи или изменения данных. Для продолжения нужно новое сообщение.') };
}

/** The review is inside invocation, so chat-wide tool auto-approval cannot bypass it. */
export class ArniReadUserProfileTool implements IToolImpl {
	private readonly review = new ProfileReviewGuard();
	constructor(
		@IArniUserProfileService private readonly profiles: IArniUserProfileService,
		@IDialogService private readonly dialogs: IDialogService,
		@IAuthenticationService private readonly authentication: IAuthenticationService,
		@INotificationService private readonly notifications?: INotificationService,
	) { }

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const resources = new DisposableStore();
		try {
			if (token.isCancellationRequested) { return this.result({ status: 'denied' }); }
			const fields = invocation.parameters.fields as string[] | undefined;
			const purpose = invocation.parameters.purpose;
			const destination = invocation.parameters.destination;
			const metadataOnly = invocation.parameters.metadataOnly === true;
			const allFields = invocation.parameters.allFields === true;
			if ((invocation.parameters.metadataOnly !== undefined && typeof invocation.parameters.metadataOnly !== 'boolean') || (invocation.parameters.allFields !== undefined && typeof invocation.parameters.allFields !== 'boolean') || (Number(fields !== undefined) + Number(metadataOnly) + Number(allFields) > 1)) { throw new Error('Choose exactly one card read mode'); }
			if (fields === undefined && !metadataOnly && !allFields) {
				return this.result({ status: 'fields_required', instruction: 'No card values were read or disclosed. Specify only the requested fields. If a custom field name is unknown, use metadataOnly:true to discover names without values. Use allFields:true only for an explicit user request for the entire card.' });
			}
			if (typeof purpose !== 'string' || !purpose.trim() || purpose.length > 500 || (destination !== undefined && (typeof destination !== 'string' || destination.length > 2000))) { throw new Error('Invalid profile request'); }
			const url = destination === undefined ? undefined : new URL(destination);
			if (url && (url.protocol !== 'https:' || url.username || url.password)) { throw new Error('Expected an HTTPS destination without credentials'); }
			const account = await this.profiles.getAccount();
			const profile = await this.profiles.read(account);
			const selected = selectArniProfileEntries(profile, fields);
			if (!metadataOnly && !selected.entries.some(field => field.value || field.id.startsWith('custom_'))) { return this.result({ status: 'missing', missingFields: selected.missingFields, instruction: 'Ask the user for missing values; use arniEditUserProfile to save user-supplied updates or open My Data. Do not guess values.' }); }
			const cancellation = resources.add(new CancellationTokenSource(token));
			resources.add(this.authentication.onDidChangeSessions(() => cancellation.cancel()));
			const lines = selected.entries.map(field => metadataOnly ? field.label : `${field.label}: ${field.value || localize('arni.profile.missing', 'не заполнено')}`);
			const confirmation = await this.review.confirm(invocation, this.dialogs, {
				custom: true, token: cancellation.token,
				message: metadataOnly ? localize('arni.profile.namesReviewTitle', 'Передать модели названия полей без значений?')
					: allFields ? localize('arni.profile.allReviewTitle', 'Передать модели ВСЮ карточку, включая все заполненные свои поля?')
						: localize('arni.profile.reviewTitle', 'Передать выбранные поля карточки модели?'),
				detail: localize('arni.profile.reviewDetail', 'Аккаунт: {0}\nЗадача: {1}\nПолучатель формы: {2}\nМодель: {3}\n\n{4}\n\nЭти сведения попадут в контекст чата и могут сохраниться в его истории. Разрешение не отправляет форму и не принимает условия сайта.', account.label, purpose, url?.href ?? localize('arni.profile.chatOnly', 'нет — просмотр в текущем чате'), invocation.modelId ?? localize('arni.profile.currentModel', 'выбранная в чате'), lines.join('\n')),
				primaryButton: localize('arni.profile.share', 'Передать эти поля'),
				cancelButton: localize('arni.profile.doNotShare', 'Не передавать'),
			}, cancellation.token, _progress, this.notifications);
			if (confirmation !== 'approved') { return reviewStopped(confirmation); }
			if (cancellation.token.isCancellationRequested) { return this.result({ status: 'denied' }); }
			const latest = selectArniProfileEntries(await this.profiles.read(account), fields);
			const names = (entries: typeof selected.entries) => entries.map(field => ({ id: field.id, label: field.label }));
			if (JSON.stringify(metadataOnly ? names(latest.entries) : latest) !== JSON.stringify(metadataOnly ? names(selected.entries) : selected)) { return this.result({ status: 'changed', instruction: 'Card changed during review. Ask the user before making a new request.' }); }
			if (cancellation.token.isCancellationRequested) { return this.result({ status: 'denied' }); }
			if (metadataOnly) { return this.result({ status: 'approved', fields: names(selected.entries) }); }
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
	private readonly review = new ProfileReviewGuard();
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
			const review = await this.review.confirm(invocation, this.dialogs, { custom: true, token: cancellation.token,
				message: localize('arni.profile.editReview', 'Сохранить изменения карточки от AI?'),
				detail: localize('arni.profile.editReviewDetail', 'Аккаунт: {0}\nЗадача: {1}\nМодель: {2}\n\n{3}\n\nБудут изменены только перечисленные поля. Прежние значения не возвращаются модели. Это не отправка анкеты.', account.label, purpose, invocation.modelId ?? localize('arni.profile.currentModel', 'выбранная в чате'), lines.join('\n')),
				primaryButton: localize('arni.profile.applyChanges', 'Сохранить изменения'), cancelButton: localize('arni.profile.cancelChanges', 'Не менять'),
			}, cancellation.token, _progress);
			if (review !== 'approved') { return reviewStopped(review); }
			if (cancellation.token.isCancellationRequested) { return result({ status: 'denied' }); }
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

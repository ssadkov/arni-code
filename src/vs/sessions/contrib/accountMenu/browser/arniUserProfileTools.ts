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
import { arniProfileFields, ArniProfileField, selectArniProfileFields } from '../common/arniUserProfile.js';
import { IArniUserProfileService } from './arniUserProfileService.js';

const readTool: IToolData = {
	id: 'arni_read_user_profile', toolReferenceName: 'arniReadUserProfile',
	displayName: localize('arni.profile.readTool', 'Получить выбранные поля карточки'),
	modelDescription: 'Request specific personal card fields for a stated task and HTTPS destination. Shows a mandatory user review before returning values to the model. Missing fields are not guessed. Do not call for unrelated tasks or repeat after refusal. Never submit a form or accept terms based on this approval.',
	source: ToolDataSource.Internal,
	inputSchema: { type: 'object', properties: {
		fields: { type: 'array', items: { type: 'string', enum: arniProfileFields.map(field => field.key) }, minItems: 1, maxItems: arniProfileFields.length, uniqueItems: true },
		purpose: { type: 'string', minLength: 1, maxLength: 500 },
		destination: { type: 'string', description: 'Exact HTTPS form/page URL that the user asked to use. No credentials in the URL.' },
	}, required: ['fields', 'purpose', 'destination'], additionalProperties: false },
};

const editTool: IToolData = {
	id: 'arni_edit_user_profile', toolReferenceName: 'arniEditUserProfile',
	displayName: localize('arni.profile.editTool', 'Открыть «Мои данные»'),
	modelDescription: 'Open the normal My Data form so the user can view, save or correct their personal card without AI. Returns no personal values and does not modify the card. After opening, ask the user to save and reply before requesting fields. Do not write card files or use shell commands to access secret storage.',
	source: ToolDataSource.Internal, inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
			const fields = invocation.parameters.fields as ArniProfileField[];
			const purpose = invocation.parameters.purpose;
			const destination = invocation.parameters.destination;
			if (typeof purpose !== 'string' || !purpose.trim() || purpose.length > 500 || typeof destination !== 'string' || destination.length > 2000) { throw new Error('Invalid profile request'); }
			const url = new URL(destination);
			if (url.protocol !== 'https:' || url.username || url.password) { throw new Error('Expected an HTTPS destination without credentials'); }
			const account = await this.profiles.getAccount();
			const profile = await this.profiles.read(account);
			const selected = selectArniProfileFields(profile.values, fields);
			const missing = fields.filter(field => !selected[field]);
			if (!Object.keys(selected).length) { return this.result({ status: 'missing', missingFields: fields, instruction: 'Open arniEditUserProfile; ask the user to save the required data and reply. Do not guess values.' }); }
			const cancellation = resources.add(new CancellationTokenSource(token));
			resources.add(this.authentication.onDidChangeSessions(() => cancellation.cancel()));
			const lines = arniProfileFields.filter(field => fields.includes(field.key)).map(field => `${field.label}: ${selected[field.key] ?? localize('arni.profile.missing', 'не заполнено')}`);
			const confirmation = await this.dialogs.confirm({
				custom: true, token: cancellation.token,
				message: localize('arni.profile.reviewTitle', 'Передать выбранные поля карточки модели?'),
				detail: localize('arni.profile.reviewDetail', 'Аккаунт: {0}\nЗадача: {1}\nПолучатель формы: {2}\nМодель: {3}\n\n{4}\n\nЭти сведения попадут в контекст чата и могут сохраниться в его истории. Разрешение не отправляет форму и не принимает условия сайта.', account.label, purpose, url.href, invocation.modelId ?? localize('arni.profile.currentModel', 'выбранная в чате'), lines.join('\n')),
				primaryButton: localize('arni.profile.share', 'Передать эти поля'),
				cancelButton: localize('arni.profile.doNotShare', 'Не передавать'),
			});
			if (!confirmation.confirmed || cancellation.token.isCancellationRequested) { return this.result({ status: 'denied' }); }
			const latest = selectArniProfileFields((await this.profiles.read(account)).values, fields);
			if (JSON.stringify(latest) !== JSON.stringify(selected)) { return this.result({ status: 'changed', instruction: 'Card changed during review. Ask the user before making a new request.' }); }
			if (cancellation.token.isCancellationRequested) { return this.result({ status: 'denied' }); }
			return this.result({ status: 'approved', destination: url.href, values: selected, missingFields: missing });
		} catch {
			return this.result({ status: 'unavailable', instruction: 'Open My Data and check sign-in, fields and destination. No values were disclosed.' });
		} finally { resources.dispose(); }
	}

	private result(value: object): IToolResult { return { content: [{ kind: 'text', value: JSON.stringify(value) }] }; }
}

class ArniEditUserProfileTool implements IToolImpl {
	constructor(@ICommandService private readonly commands: ICommandService) { }
	async invoke(): Promise<IToolResult> {
		await this.commands.executeCommand('arni.openUserProfile');
		return { content: [{ kind: 'text', value: 'My Data is open. No values have been read or changed by this tool. Ask the user to save and reply; do not poll.' }] };
	}
}

export class ArniUserProfileTools extends Disposable {
	static readonly ID = 'arni.personalCard.tools';
	constructor(@ILanguageModelToolsService tools: ILanguageModelToolsService, @IInstantiationService instantiation: IInstantiationService) {
		super();
		const toolSet = this._register(tools.createToolSet(ToolDataSource.Internal, 'arni-personal-card', 'arniPersonalCard', {
			icon: Codicon.account,
			description: localize('arni.profile.toolSet', 'Мои данные'),
			detail: localize('arni.profile.toolSetDetail', 'Открыть карточку или запросить выбранные поля с отдельным подтверждением.'),
		}));
		this._register(tools.registerTool(readTool, instantiation.createInstance(ArniReadUserProfileTool)));
		this._register(tools.registerTool(editTool, instantiation.createInstance(ArniEditUserProfileTool)));
		this._register(toolSet.addTool(readTool));
		this._register(toolSet.addTool(editTool));
	}
}
registerWorkbenchContribution2(ArniUserProfileTools.ID, ArniUserProfileTools, WorkbenchPhase.AfterRestored);

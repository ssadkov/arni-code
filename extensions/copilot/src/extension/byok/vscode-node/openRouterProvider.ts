/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IChatMLFetcher } from '../../../platform/chat/common/chatMLFetcher';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IDomainService } from '../../../platform/endpoint/common/domainService';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';

import { IChatWebSocketManager } from '../../../platform/networking/node/chatWebSocketManager';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITokenizerProvider } from '../../../platform/tokenizer/node/tokenizer';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities } from '../common/byokProvider';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';
import * as vscode from 'vscode';
import { CancellationToken, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, PrepareLanguageModelChatModelOptions, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { byokKnownModelsToAPIInfoWithEffort } from './byokModelInfo';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { ArniImageTool } from './arniImageTool';
import { isNonRetryableBYOKError } from '../common/byokErrorPolicy';

interface ArniBudgetWindow {
	usedMicros: number;
	limitMicros: number;
	requests: number;
	requestLimit: number;
	resetsAt: string | null;
}

interface ArniBudget {
	enabled: boolean;
	expired: boolean;
	balanceMicros: number;
	validUntil: string;
	fiveHour: ArniBudgetWindow;
	weekly: ArniBudgetWindow;
}

interface OpenRouterModelData {
	id: string;
	name: string;
	arni_provider?: 'bedrock' | 'openrouter';
	arni_free?: boolean;
	arni_cache?: 'explicit' | 'automatic';
	pricing?: { prompt?: string; completion?: string };
	supported_parameters?: string[];
	architecture?: {
		input_modalities?: string[];
	};
	/**
	 * The model's actual maximum context window, independent of which provider
	 * OpenRouter ranks highest. Prefer this over `top_provider.context_length`,
	 * which only reflects the primary provider and can be far smaller for
	 * multi-provider models.
	 * @see https://openrouter.ai/docs/guides/overview/models
	 */
	context_length?: number;
	top_provider: {
		context_length: number;
		/** Maximum tokens the primary provider will produce in a response. */
		max_completion_tokens?: number;
	};
}

/**
 * Fallback output-token budget used only when OpenRouter does not report
 * `top_provider.max_completion_tokens` for a model. The value is heuristic — most
 * tool-capable models do report an explicit budget, in which case this is unused.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
// vercel.app is blocked in Russia; api.arnion.ru is a proxy in Russia that
// forwards to the Vercel backend (arni-backend/deploy/ru-proxy).
const DEFAULT_ARNI_BACKEND_ORIGIN = 'https://api.arnion.ru';

/**
 * Backends tried in order when the user has not set their own `arni.backendUrl`:
 * the Russian proxy first, then Vercel directly, which works abroad and over VPN.
 */
const ARNI_BACKEND_ORIGINS = [DEFAULT_ARNI_BACKEND_ORIGIN, 'https://arni-backend.vercel.app'] as const;

/**
 * Normalize `arni.backendUrl` to the origin. The setting default is the
 * origin; some callers historically stored a trailing `/api`.
 */
export function resolveArniBackendOrigin(backendUrl: string | undefined): string {
	const raw = (backendUrl && backendUrl.trim()) || DEFAULT_ARNI_BACKEND_ORIGIN;
	return raw.replace(/\/+$/, '').replace(/\/api$/i, '');
}

/** OpenAI-compatible Arni proxy base (`…/api`), used for `/chat/completions`. */
export function resolveArniApiBaseUrl(backendUrl: string | undefined): string {
	return `${resolveArniBackendOrigin(backendUrl)}/api`;
}

/** Free OpenRouter coding/agent models, preferred first for Arni's default picker. */
export const PREFERRED_FREE_OPENROUTER_MODELS = [
	'nvidia/nemotron-3-ultra-550b-a55b:free',
	'poolside/laguna-s-2.1:free',
	'cohere/north-mini-code:free',
	'nex-agi/nex-n2.5-mini:free',
] as const;

export const DEFAULT_OPENROUTER_MODEL_ID = PREFERRED_FREE_OPENROUTER_MODELS[0];

export interface OpenRouterTrafficModel {
	readonly id: string;
	readonly arni_default?: boolean;
	readonly arni_traffic?: 'green' | 'yellow' | 'red' | 'unknown';
}

/**
 * The model a new chat should start on. Without traffic lights this stays the
 * historical default. A red light moves to the next preferred model that is not red.
 */
export function preferredDefaultModelId(models: readonly OpenRouterTrafficModel[]): string {
	const managedDefault = models.find(model => model.arni_default)?.id;
	if (managedDefault) {
		return managedDefault;
	}
	if (!models.some(model => model.arni_traffic)) {
		return DEFAULT_OPENROUTER_MODEL_ID;
	}
	for (const id of PREFERRED_FREE_OPENROUTER_MODELS) {
		const model = models.find(item => item.id === id);
		if (model && model.arni_traffic !== 'red') {
			return id;
		}
	}
	return DEFAULT_OPENROUTER_MODEL_ID;
}

/** Direct OpenRouter catalog. It refuses requests from Russia, so it is only a fallback. */
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?supported_parameters=tools';

/**
 * Last resort when neither the Arni backend nor OpenRouter returns a catalog:
 * without any model the agent host falls back to demanding GitHub sign-in.
 * Context lengths are conservative, not exact.
 */
const FALLBACK_OPENROUTER_MODELS: readonly OpenRouterModelData[] = PREFERRED_FREE_OPENROUTER_MODELS.map(id => ({
	id,
	name: id,
	supported_parameters: ['tools'],
	context_length: 131_072,
	top_provider: { context_length: 131_072 },
}));

/**
 * Marks an error the user should read as is. The agent host's BYOK proxy
 * (`byokLmProxyService.ts`) strips it and answers 400 instead of 502, so the
 * agent shows the text once instead of retrying the request.
 */
const ARNI_USER_ERROR_PREFIX = '[arni-user-error] ';

/** Command that adds the signed-in user to the Pro plan waitlist. */
export const JOIN_PRO_WAITLIST_COMMAND = 'arni.joinProWaitlist';

/**
 * Only OpenRouter's free models are offered until the Pro plan exists; the
 * backend also refuses paid models for FREE users.
 */
function isFreeOpenRouterModel(model: OpenRouterModelData): boolean {
	return model.id.endsWith(':free');
}

export function rankOpenRouterModelId(id: string): number {
	const preferred = (PREFERRED_FREE_OPENROUTER_MODELS as readonly string[]).indexOf(id);
	if (preferred !== -1) {
		return preferred;
	}
	return id.endsWith(':free') ? PREFERRED_FREE_OPENROUTER_MODELS.length : PREFERRED_FREE_OPENROUTER_MODELS.length + 1;
}

export class OpenRouterLMProvider extends AbstractOpenAICompatibleLMProvider {

	public static readonly providerName = 'OpenRouter';
	public static readonly providerId = this.providerName.toLowerCase();

	private _arniJwt: string | undefined;
	/** The backend `/api` base that last answered; tried first next time. */
	private _reachableApiBase: string | undefined;
	private _freeStepsItem: vscode.StatusBarItem | undefined;
	private _activeChatId: string | undefined;
	private readonly _disposables = new DisposableStore();
	private readonly _onDidChangeLanguageModelChatInformation = this._disposables.add(new vscode.EventEmitter<void>());
	public readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			OpenRouterLMProvider.providerId,
			OpenRouterLMProvider.providerName,
			undefined,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
		try {
			this._disposables.add(vscode.commands.registerCommand(JOIN_PRO_WAITLIST_COMMAND, () => this.joinProWaitlist()));
			this._disposables.add(vscode.commands.registerCommand('arni.showApiUsage', () => this.showApiUsage()));
			this._disposables.add(vscode.commands.registerCommand('arni.getAccountSummary', () => this.getAccountSummary()));
		} catch {
			// vscode.commands is unavailable in unit tests
		}
		try {
			this._disposables.add(vscode.authentication.onDidChangeSessions(e => {
				if (e.provider.id === 'yandex' || e.provider.id === 'vk') {
					this._arniJwt = undefined;
					this._freeStepsItem?.hide();
					this._onDidChangeLanguageModelChatInformation.fire();
				}
			}));
		} catch {
			// vscode.authentication is unavailable in unit tests
		}
	}

	dispose(): void {
		this._disposables.dispose();
	}

	public createImageTool(): ArniImageTool {
		return new ArniImageTool(this._fetcherService, async () => {
			const token = await this.resolveArniApiKey(false);
			if (!token) { throw new Error(vscode.l10n.t('Sign in to ArniCode to generate images.')); }
			return { token, apiBase: this._reachableApiBase ?? this.getBackendApiCandidates()[0] };
		});
	}

	override async provideLanguageModelChatInformation(options: PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		const apiKey = await this.resolveArniApiKey(options.silent, options.configuration?.apiKey);
		if (apiKey && !this._freeStepsItem?.text) {
			void this.refreshFreeSteps(apiKey);
		}
		const configuration: LanguageModelChatConfiguration = { ...options.configuration, apiKey };
		const models = await this.getAllModels(options.silent, apiKey, configuration);
		return models.map(model => ({
			...model,
			isBYOK: true,
			configuration
		}));
	}

	override async provideLanguageModelChatResponse(model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>, messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Promise<void> {
		const storedKey = model.configuration?.apiKey || options.modelConfiguration?.apiKey;
		const apiKey = await this.resolveArniApiKey(false, storedKey);
		if (!apiKey) {
			throw new Error('Sign in with Yandex or VK to use OpenRouter models.');
		}
		try {
			const arniChatId = typeof options.modelOptions?.arniChatId === 'string' ? options.modelOptions.arniChatId : undefined;
			this._activeChatId = arniChatId;
			const configuration = { ...model.configuration, apiKey, arniChatId };
			const result = await super.provideLanguageModelChatResponse({ ...model, configuration }, messages, options, progress, token);
			void this.refreshFreeSteps(apiKey);
			return result;
		} catch (error) {
			void this.refreshFreeSteps(apiKey);
			throw this.toUserFacingError(error);
		}
	}

	private showFreeSteps(steps: { used: number; limit: number; remaining: number; resetsAt: string; total: number } | undefined): void {
		if (!steps) {
			return;
		}
		try {
			if (!this._freeStepsItem) {
				this._freeStepsItem = this._disposables.add(vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100));
				this._freeStepsItem.name = vscode.l10n.t('Баланс Arni');
			}
			const reset = steps.resetsAt.slice(11, 16);
			this._freeStepsItem.text = steps.remaining > 0
				? `$(sparkle) ${steps.remaining} шагов`
				: `$(warning) 0 шагов`;
			this._freeStepsItem.tooltip = steps.remaining > 0
				? `Бесплатные шаги: ${steps.used} из ${steps.limit} сегодня, осталось ${steps.remaining}. Сброс в ${reset} UTC. Всего использовано ${steps.total}.`
				: `Дневной лимит бесплатных шагов исчерпан. Сброс в ${reset} UTC. Всего использовано ${steps.total}.`;
			this._freeStepsItem.show();
		} catch {
			// vscode.window is unavailable in unit tests
		}
	}

	private showBudget(budget: ArniBudget): void {
		try {
			if (!this._freeStepsItem) {
				this._freeStepsItem = this._disposables.add(vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100));
				this._freeStepsItem.name = vscode.l10n.t('Баланс Arni');
			}
			const money = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
			this._freeStepsItem.command = 'arni.showApiUsage';
			const available = Math.max(0, Math.min(budget.balanceMicros, budget.fiveHour.limitMicros - budget.fiveHour.usedMicros, budget.weekly.limitMicros - budget.weekly.usedMicros));
			this._freeStepsItem.text = budget.expired
				? `$(warning) ${vscode.l10n.t('Срок доступа истёк')}` : !budget.enabled
					? `$(warning) ${vscode.l10n.t('Доступ приостановлен')}` : `$(sparkle) ${vscode.l10n.t('API {0}', money(available))}`;
			const windowText = (window: ArniBudgetWindow) => vscode.l10n.t('{0} из {1}; запросы {2}/{3}; сброс: {4}',
				money(window.usedMicros), money(window.limitMicros), window.requests, window.requestLimit,
				window.resetsAt ? new Date(window.resetsAt).toLocaleString() : vscode.l10n.t('после первого запроса'));
			this._freeStepsItem.tooltip = vscode.l10n.t('Бюджет API: {0}\n5 часов: {1}\nНеделя: {2}\nДоступ до: {3}',
				money(budget.balanceMicros), windowText(budget.fiveHour), windowText(budget.weekly), new Date(budget.validUntil).toLocaleString());
			this._freeStepsItem.show();
		} catch { /* vscode.window is unavailable in unit tests. */ }
	}

	private async showApiUsage(): Promise<void> {
		const apiKey = await this.resolveArniApiKey(false);
		if (!apiKey) { return; }
		const base = this._reachableApiBase ?? this.getBackendApiCandidates()[0];
		const selection = await vscode.window.showQuickPick([
			...(this._activeChatId ? [{ label: vscode.l10n.t('Текущий чат'), chatId: this._activeChatId }] : []),
			{ label: vscode.l10n.t('Все запросы аккаунта'), chatId: undefined },
		], { title: vscode.l10n.t('Расходы API в USD') });
		if (!selection) { return; }
		try {
			const response = await fetch(`${base}/account/usage${selection.chatId ? `?chatId=${encodeURIComponent(selection.chatId)}` : ''}`, { headers: { Authorization: `Bearer ${apiKey}` } });
			if (!response.ok) { throw new Error(vscode.l10n.t('Не удалось загрузить расходы API ({0})', response.status)); }
			const data = await response.json() as { totalMicros: number; requestCount: number; requests: { model: string; createdAt: string; costMicros: number | null; accounting: string; promptTokens: number; completionTokens: number; cacheReadTokens: number }[] };
			await vscode.window.showQuickPick(data.requests.map(row => ({
				label: `${row.costMicros == null ? '—' : `$${(row.costMicros / 1_000_000).toFixed(6)}`} · ${row.model}`,
				description: `${new Date(row.createdAt).toLocaleString()} · ${row.accounting}`,
				detail: vscode.l10n.t('Вход: {0}; выход: {1}; из кэша: {2}', row.promptTokens, row.completionTokens, row.cacheReadTokens),
			})), { title: vscode.l10n.t('Всего ${0} · {1} запросов; показаны последние 100', (data.totalMicros / 1_000_000).toFixed(6), data.requestCount) });
		} catch (error) { void vscode.window.showErrorMessage(String(error)); }
	}

	private async refreshFreeSteps(apiKey: string): Promise<void> {
		for (const apiBase of this.getBackendApiCandidates()) {
			try {
				const response = await fetch(`${apiBase}/account`, {
					headers: { Authorization: `Bearer ${apiKey}` },
				});
				if (!response.ok) {
					continue;
				}
				this._reachableApiBase = apiBase;
				const data = await response.json() as { user?: { budget?: ArniBudget; freeSteps?: { used: number; limit: number; remaining: number; resetsAt: string; total: number } } };
				if (data.user?.budget) { this.showBudget(data.user.budget); }
				else { this.showFreeSteps(data.user?.freeSteps); }
				return;
			} catch (error) {
				this._logService.warn(`Unable to load free steps from ${apiBase}: ${String(error)}`);
			}
		}
	}

	/** Read-only bridge for the always-visible Agents account widget. Never returns credentials. */
	private async getAccountSummary(): Promise<unknown> {
		const apiKey = await this.resolveArniApiKey(true);
		if (!apiKey) { return undefined; }
		const base = this._reachableApiBase ?? this.getBackendApiCandidates()[0];
		const headers = { Authorization: `Bearer ${apiKey}` };
		const response = await fetch(`${base}/account`, { headers, signal: AbortSignal.timeout(10_000) });
		if (!response.ok) { throw new Error(`Account HTTP ${response.status}`); }
		const data = await response.json() as { user: Record<string, unknown> };
		let chatCostMicros: number | undefined;
		if (this._activeChatId) {
			const usage = await fetch(`${base}/account/usage?chatId=${encodeURIComponent(this._activeChatId)}`, { headers, signal: AbortSignal.timeout(10_000) });
			if (usage.ok) { chatCostMicros = (await usage.json() as { totalMicros: number }).totalMicros; }
		}
		return { ...data.user, chatCostMicros };
	}

	/**
	 * The backend answers 402 for paid models without the Pro plan and 429 for
	 * the free daily limit, with a Russian message. Pass those on as is and
	 * offer the Pro waitlist when a paid model was refused.
	 */
	private toUserFacingError(error: unknown): unknown {
		if (!(error instanceof Error)) {
			return error;
		}
		if (isNonRetryableBYOKError(error.message)) {
			return new Error(ARNI_USER_ERROR_PREFIX + error.message);
		}
		if (error.name === 'ChatQuotaExceeded') {
			// The 402 message is replaced by Copilot's quota text on the way here.
			void this.offerProWaitlist();
			return new Error(ARNI_USER_ERROR_PREFIX + vscode.l10n.t('Эта модель будет доступна в тарифе Pro. Выберите бесплатную модель.'));
		}
		if (error.name === 'ChatRateLimited' && error.message) {
			return new Error(ARNI_USER_ERROR_PREFIX + error.message);
		}
		return error;
	}

	private async offerProWaitlist(): Promise<void> {
		const notify = vscode.l10n.t('Сообщить о запуске');
		const choice = await vscode.window.showInformationMessage(vscode.l10n.t('Платные модели (Claude, GPT и другие) появятся в тарифе Pro.'), notify);
		if (choice === notify) {
			await this.joinProWaitlist();
		}
	}

	/** Adds the user to the Pro waitlist, asking for a contact when the account has no email. */
	private async joinProWaitlist(): Promise<void> {
		const apiKey = await this.resolveArniApiKey(false);
		if (!apiKey) {
			return;
		}
		let status = await this.postProWaitlist(apiKey, undefined);
		if (status?.needsContact) {
			const contact = await vscode.window.showInputBox({
				title: vscode.l10n.t('Сообщить о запуске Pro'),
				prompt: vscode.l10n.t('Куда написать, когда Pro откроется? Почта или Telegram.'),
				placeHolder: vscode.l10n.t('name@example.ru или @username'),
				ignoreFocusOut: true,
			});
			if (contact?.trim()) {
				status = await this.postProWaitlist(apiKey, contact.trim());
			}
		}
		if (status?.joined) {
			void vscode.window.showInformationMessage(vscode.l10n.t('Готово! Напишем, когда тариф Pro откроется.'));
		} else {
			void vscode.window.showWarningMessage(vscode.l10n.t('Не получилось записаться. Попробуйте позже.'));
		}
	}

	private async postProWaitlist(apiKey: string, contact: string | undefined): Promise<{ joined: boolean; needsContact: boolean } | undefined> {
		try {
			const response = await fetch(`${this.getModelsBaseUrl()}/waitlist`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
				body: JSON.stringify(contact ? { contact } : {}),
			});
			if (!response.ok) {
				this._logService.warn(`Pro waitlist request failed: ${response.status}`);
				return undefined;
			}
			return await response.json() as { joined: boolean; needsContact: boolean };
		} catch (e) {
			this._logService.warn(`Pro waitlist request failed: ${String(e)}`);
			return undefined;
		}
	}

	private getConfiguredBackendUrl(): string | undefined {
		return vscode.workspace.getConfiguration('arni').get<string>('backendUrl');
	}

	/**
	 * `/api` bases to try, the last reachable one first. A custom
	 * `arni.backendUrl` is used alone.
	 */
	protected getBackendApiCandidates(): string[] {
		const configured = resolveArniBackendOrigin(this.getConfiguredBackendUrl());
		const origins: readonly string[] = configured === DEFAULT_ARNI_BACKEND_ORIGIN ? ARNI_BACKEND_ORIGINS : [configured];
		const bases = origins.map(origin => `${origin}/api`);
		const reachable = this._reachableApiBase;
		return reachable && bases.includes(reachable) ? [reachable, ...bases.filter(base => base !== reachable)] : bases;
	}

	private static readonly _arniAuthProviders = ['yandex', 'vk'] as const;

	private async exchangeArniSession(provider: 'yandex' | 'vk', accessToken: string): Promise<string | undefined> {
		let response: Response | undefined;
		for (const apiBase of this.getBackendApiCandidates()) {
			try {
				response = await fetch(`${apiBase}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ provider, token: accessToken })
				});
				this._reachableApiBase = apiBase;
				break;
			} catch (e) {
				this._logService.warn(`Arni backend unreachable at ${apiBase}: ${String(e)}`);
			}
		}
		if (!response) {
			this._logService.error(`Failed to exchange ${provider} token: no Arni backend is reachable`);
			return undefined;
		}
		if (response.ok) {
			const data = await response.json() as { token?: string; user?: { freeSteps?: { used: number; limit: number; remaining: number; resetsAt: string; total: number } } };
			if (data.token) {
				this._arniJwt = data.token;
				this.showFreeSteps(data.user?.freeSteps);
				return data.token;
			}
			return undefined;
		}
		this._logService.error(`Failed to exchange ${provider} token: ` + await response.text());
		this._arniJwt = undefined;
		return undefined;
	}

	private async resolveArniApiKey(silent: boolean, storedApiKey?: string): Promise<string | undefined> {
		if (this._arniJwt) {
			return this._arniJwt;
		}

		try {
			const signedInProviders: (typeof OpenRouterLMProvider._arniAuthProviders)[number][] = [];
			for (const provider of OpenRouterLMProvider._arniAuthProviders) {
				try {
					if ((await vscode.authentication.getAccounts(provider)).length > 0) {
						signedInProviders.push(provider);
					}
				} catch (error) {
					this._logService.warn(`Unable to inspect ${provider} accounts: ${String(error)}`);
				}
			}

			// A signed-in product account may not yet be available to this extension.
			// Probe without requesting access, then ask only for the provider the user chose.
			for (const provider of signedInProviders) {
				const session = await vscode.authentication.getSession(provider, [], { silent: true });
				if (session) {
					const token = await this.exchangeArniSession(provider, session.accessToken);
					if (token) {
						return token;
					}
				}
			}

			if (!silent) {
				const providersToPrompt = signedInProviders.length > 0 ? signedInProviders : OpenRouterLMProvider._arniAuthProviders;
				for (const provider of providersToPrompt) {
					const session = await vscode.authentication.getSession(provider, [], { createIfNone: true });
					if (session) {
						const token = await this.exchangeArniSession(provider, session.accessToken);
						if (token) {
							return token;
						}
					}
				}
			}
		} catch (e) {
			this._logService.error(e as Error, 'Arni product auth error');
		}

		if (storedApiKey) {
			return storedApiKey;
		}
		return silent ? undefined : this.configureDefaultGroupWithApiKeyOnly();
	}

	protected override async getAllModels(silent: boolean, apiKey: string | undefined, configuration: any | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<any>[]> {
		const catalog = await this.fetchModelCatalog(apiKey);
		// Chat requests go to whichever backend answered the catalog request.
		const modelsUrl = this.getModelsBaseUrl();
		const models: any = {};
		for (const m of catalog) {
			models[m.id] = this.resolveModelCapabilities(m) || {
				name: m.name || m.id,
				toolCalling: false,
				vision: false,
				maxInputTokens: 8000,
				maxOutputTokens: 4000
			};
		}

		// This override bypasses the base discovery path, which is what normally
		// records capabilities. Without them `resolveModelInfo` reports
		// `tool_calls: false` and `interceptBody` strips the tools from every
		// request, so models can only imitate tool calls in chat text.
		this._knownModels = { ...this._knownModels, ...models };

		const byokModels = byokKnownModelsToAPIInfoWithEffort(this._name, models);
		const defaultModelId = preferredDefaultModelId(catalog);
		return byokModels
			.map(model => ({
				...model,
				url: modelsUrl!,
				isDefault: model.id === defaultModelId
			}))
			.sort((a, b) => {
				const rank = rankOpenRouterModelId(a.id) - rankOpenRouterModelId(b.id);
				return rank !== 0 ? rank : a.id.localeCompare(b.id);
			}) as OpenAICompatibleLanguageModelChatInformation<any>[];
	}

	/**
	 * The catalog is public, so it needs no key. The Arni backend proxies it
	 * because openrouter.ai refuses requests from Russia; the direct URL and a
	 * built-in list keep the picker usable if the backend is unreachable.
	 */
	private async fetchModelCatalog(apiKey?: string): Promise<readonly OpenRouterModelData[]> {
		const backendUrls = this.getBackendApiCandidates().map(apiBase => ({ url: `${apiBase}/models`, apiBase }));
		for (const { url, apiBase } of [...backendUrls, { url: OPENROUTER_MODELS_URL, apiBase: undefined }]) {
			try {
				const res = await fetch(url, apiBase && apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined);
				if (res.ok) {
					const json = await res.json() as { data?: OpenRouterModelData[]; arni_managed?: boolean };
					// The backend already sends only free models; the direct OpenRouter catalog does not.
					const managed = apiBase && apiKey && json.arni_managed;
					const models = managed ? json.data : json.data?.filter(isFreeOpenRouterModel);
					if (managed && !models?.length) { this._reachableApiBase = apiBase; return []; }
					if (models?.length) {
						if (apiBase) {
							this._reachableApiBase = apiBase;
						}
						return models;
					}
				}
				this._logService.warn(`OpenRouter model catalog unavailable from ${url}: ${res.status}`);
			} catch (e) {
				this._logService.warn(`OpenRouter model catalog unavailable from ${url}: ${String(e)}`);
			}
		}
		this._logService.warn('Using the built-in list of free OpenRouter models');
		return FALLBACK_OPENROUTER_MODELS;
	}

	protected override getModelsBaseUrl(): string | undefined {
		return this._reachableApiBase ?? this.getBackendApiCandidates()[0];
	}

	protected override getModelsDiscoveryUrl(_modelsBaseUrl: string): string {
		return `${this.getModelsBaseUrl()}/models`;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const openRouterModelData = modelData as OpenRouterModelData;
		const supportedParameters = openRouterModelData.supported_parameters ?? [];
		// OpenRouter reports reasoning support per model via `supported_parameters`. The unified `reasoning` parameter and
		// the OpenAI-style `reasoning_effort` alias both indicate the model accepts an effort level.
		// See https://openrouter.ai/docs/use-cases/reasoning-tokens
		const supportsReasoningEffort = supportedParameters.includes('reasoning') || supportedParameters.includes('reasoning_effort')
			? ['low', 'medium', 'high']
			: undefined;
		// Prefer the model-level `context_length` (the real capability) over
		// `top_provider.context_length`, which only reflects OpenRouter's
		// highest-ranked provider and can be much smaller for multi-provider models.
		const contextWindow = openRouterModelData.context_length ?? openRouterModelData.top_provider.context_length;
		// Reserve output tokens from the window. Clamp the reserve so a small-context
		// model (or a missing/oversized `max_completion_tokens`) never yields a
		// non-positive prompt budget.
		const requestedMaxOutputTokens = openRouterModelData.top_provider.max_completion_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
		const maxOutputTokens = Math.min(requestedMaxOutputTokens, Math.floor(contextWindow / 2));
		const price = openRouterModelData.pricing;
		const rates = price && [price.prompt, price.completion].map(value => Number((Number(value) * 1_000_000).toFixed(6)));
		const priceLabel = rates?.every(value => Number.isFinite(value) && value >= 0)
			? vscode.l10n.t(' · ${0}/${1} за 1М вх./вых.', rates[0], rates[1]) : '';
		const labels = openRouterModelData.arni_provider ? [
			openRouterModelData.arni_free ? vscode.l10n.t('Бесплатная') : vscode.l10n.t('Платная'),
			...(openRouterModelData.architecture?.input_modalities?.includes('image') ? [vscode.l10n.t('Изображения')] : []),
			...(openRouterModelData.arni_cache ? [vscode.l10n.t('Кэш')] : []),
		].join(' · ') : '';
		const source = openRouterModelData.arni_provider === 'bedrock' ? 'AWS Bedrock' : openRouterModelData.arni_provider === 'openrouter' ? 'OpenRouter' : undefined;
		const name = source ? vscode.l10n.t('{0} · {1}', source, openRouterModelData.name) : openRouterModelData.name;
		return {
			name: name + priceLabel + (labels ? ` · ${labels}` : ''),
			toolCalling: supportedParameters.includes('tools'),
			vision: openRouterModelData.architecture?.input_modalities?.includes('image') ?? false,
			maxInputTokens: contextWindow - maxOutputTokens,
			maxOutputTokens,
			supportsReasoningEffort
		};
	}

	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>): Promise<OpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
		const chatId = (model.configuration as LanguageModelChatConfiguration & { arniChatId?: string } | undefined)?.arniChatId;
		if (chatId && !isOpenRouterBaseUrl(model.url)) {
			modelInfo.requestHeaders = { ...modelInfo.requestHeaders, 'X-Arni-Chat-Id': chatId };
		}
		// The Arni proxy exposes only an OpenAI-compatible `/chat/completions`
		// route, so Anthropic's native Messages API is reachable solely when
		// requests go straight to OpenRouter.
		const useMessagesApi = isAnthropicModelId(model.id) && isOpenRouterBaseUrl(model.url);

		if (useMessagesApi) {
			// The native Messages API provides full cache_control, thinking, and
			// tool support identical to the direct Anthropic API.
			modelInfo.supported_endpoints = [ModelSupportedEndpoint.Messages];
		}

		const url = useMessagesApi
			? `${model.url}/messages`
			: `${model.url}/chat/completions`;

		const apiKey = model.configuration?.apiKey ?? this._arniJwt ?? '';
		return this._instantiationService.createInstance(OpenRouterEndpoint, modelInfo, apiKey, url);
	}
}

/**
 * Checks whether an OpenRouter model ID refers to an Anthropic model.
 * OpenRouter model IDs follow the format `provider/model-name`, e.g.
 * `anthropic/claude-sonnet-4` or `anthropic/claude-opus-4`.
 */
function isAnthropicModelId(modelId: string): boolean {
	return modelId.startsWith('anthropic/');
}

/** True when requests go directly to OpenRouter rather than through a proxy. */
export function isOpenRouterBaseUrl(baseUrl: string): boolean {
	try {
		const hostname = new URL(baseUrl).hostname.toLowerCase();
		return hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai');
	} catch {
		return false;
	}
}

/**
 * OpenRouter-specific endpoint that routes Anthropic models through the native
 * Messages API (`/api/v1/messages`) for full prompt caching, thinking, and tool
 * support identical to the direct Anthropic API.
 *
 * @see https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages
 */
export class OpenRouterEndpoint extends OpenAIEndpoint {
	constructor(
		modelMetadata: IChatModelInformation,
		apiKey: string,
		modelUrl: string,
		@IDomainService domainService: IDomainService,
		@IChatMLFetcher chatMLFetcher: IChatMLFetcher,
		@ITokenizerProvider tokenizerProvider: ITokenizerProvider,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@IChatWebSocketManager chatWebSocketService: IChatWebSocketManager,
		@ILogService logService: ILogService,
	) {
		super(modelMetadata, apiKey, modelUrl, domainService, chatMLFetcher, tokenizerProvider, instantiationService, configurationService, expService, chatWebSocketService, logService);
	}

	/**
	 * Enable the Messages API path for Anthropic models. This bypasses the
	 * experiment flag check in the base class because BYOK models are always
	 * user-controlled — the `supported_endpoints` metadata is already set
	 * correctly by {@link OpenRouterLMProvider.createOpenAIEndPoint}.
	 */
	protected override get useMessagesApi(): boolean {
		return !!this.modelMetadata.supported_endpoints?.includes(ModelSupportedEndpoint.Messages);
	}

	public override getExtraHeaders(): Record<string, string> {
		const headers = super.getExtraHeaders();
		if (this.useMessagesApi) {
			Object.assign(headers, this.getAnthropicBetaHeader());
		}
		return headers;
	}
}

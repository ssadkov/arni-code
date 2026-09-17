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

interface OpenRouterModelData {
	id: string;
	name: string;
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
const DEFAULT_ARNI_BACKEND_ORIGIN = 'https://arni-backend.vercel.app';

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
	private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
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
			vscode.authentication.onDidChangeSessions(e => {
				if (e.provider.id === 'yandex') {
					this._arniJwt = undefined;
					this._onDidChangeLanguageModelChatInformation.fire();
				}
			});
		} catch {
			// vscode.authentication is unavailable in unit tests
		}
	}

	override async provideLanguageModelChatInformation(options: PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		const apiKey = await this.resolveArniApiKey(options.silent, options.configuration?.apiKey);
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
			throw new Error('Sign in with Yandex ID to use OpenRouter models.');
		}
		return super.provideLanguageModelChatResponse({ ...model, configuration: { ...model.configuration, apiKey } }, messages, options, progress, token);
	}

	private getConfiguredBackendUrl(): string | undefined {
		return vscode.workspace.getConfiguration('arni').get<string>('backendUrl');
	}

	private async resolveArniApiKey(silent: boolean, storedApiKey?: string): Promise<string | undefined> {
		try {
			let session = await vscode.authentication.getSession('yandex', [], { createIfNone: false });
			if (!session && !silent) {
				session = await vscode.authentication.getSession('yandex', [], { createIfNone: true });
			}

			if (session) {
				const response = await fetch(`${resolveArniApiBaseUrl(this.getConfiguredBackendUrl())}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ provider: 'yandex', token: session.accessToken })
				});
				if (response.ok) {
					const data = await response.json() as { token?: string };
					if (data.token) {
						this._arniJwt = data.token;
						return data.token;
					}
				} else {
					this._logService.error('Failed to exchange Yandex token: ' + await response.text());
					this._arniJwt = undefined;
				}
			}
		} catch (e) {
			this._logService.error(e as Error, 'Yandex Auth Error');
		}

		if (this._arniJwt) {
			return this._arniJwt;
		}
		if (storedApiKey) {
			return storedApiKey;
		}
		return this.configureDefaultGroupWithApiKeyOnly();
	}

	protected override async getAllModels(silent: boolean, apiKey: string | undefined, configuration: any | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<any>[]> {
		const modelsUrl = this.getModelsBaseUrl();
		let models: any = {};
		
		try {
			// Fetch models from OpenRouter DIRECTLY without any API key to bypass 401 error.
			const res = await fetch(this.getModelsDiscoveryUrl(''));
			if (res.ok) {
				const json = await res.json() as { data?: OpenRouterModelData[] };
				for (const m of json.data || []) {
					models[m.id] = this.resolveModelCapabilities(m) || {
						name: m.name || m.id,
						toolCalling: false,
						vision: false,
						maxInputTokens: 8000,
						maxOutputTokens: 4000
					};
				}
			}
		} catch (e) {
			this._logService.error(e as Error, 'Error fetching OpenRouter models');
		}

		// This override bypasses the base discovery path, which is what normally
		// records capabilities. Without them `resolveModelInfo` reports
		// `tool_calls: false` and `interceptBody` strips the tools from every
		// request, so models can only imitate tool calls in chat text.
		this._knownModels = { ...this._knownModels, ...models };

		const byokModels = byokKnownModelsToAPIInfoWithEffort(this._name, models);
		return byokModels
			.map(model => ({
				...model,
				url: modelsUrl!,
				isDefault: model.id === DEFAULT_OPENROUTER_MODEL_ID
			}))
			.sort((a, b) => {
				const rank = rankOpenRouterModelId(a.id) - rankOpenRouterModelId(b.id);
				return rank !== 0 ? rank : a.id.localeCompare(b.id);
			}) as OpenAICompatibleLanguageModelChatInformation<any>[];
	}

	protected override getModelsBaseUrl(): string | undefined {
		return resolveArniApiBaseUrl(this.getConfiguredBackendUrl());
	}

	protected override getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		return `https://openrouter.ai/api/v1/models?supported_parameters=tools`;
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
		return {
			name: openRouterModelData.name,
			toolCalling: supportedParameters.includes('tools'),
			vision: openRouterModelData.architecture?.input_modalities?.includes('image') ?? false,
			maxInputTokens: contextWindow - maxOutputTokens,
			maxOutputTokens,
			supportsReasoningEffort
		};
	}

	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>): Promise<OpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
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

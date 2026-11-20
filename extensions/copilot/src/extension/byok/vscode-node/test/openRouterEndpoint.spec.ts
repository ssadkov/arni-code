/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../../platform/endpoint/common/endpointProvider';
import { ICreateEndpointBodyOptions } from '../../../../platform/networking/common/networking';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { TokenizerType } from '../../../../util/common/tokenizer';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { OpenRouterEndpoint } from '../openRouterProvider';

describe('OpenRouterEndpoint', () => {
	const disposables = new DisposableStore();
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;

	beforeEach(() => {
		const testingServiceCollection = createExtensionUnitTestingServices();
		accessor = disposables.add(testingServiceCollection.createTestingAccessor());
		instaService = accessor.get(IInstantiationService);
	});

	afterEach(() => {
		disposables.clear();
	});

	describe('Anthropic models — Messages API', () => {
		let anthropicMetadata: IChatModelInformation;

		beforeEach(() => {
			anthropicMetadata = {
				id: 'anthropic/claude-sonnet-4',
				name: 'Claude Sonnet 4',
				vendor: 'OpenRouter',
				version: '1.0',
				model_picker_enabled: true,
				is_chat_default: false,
				is_chat_fallback: false,
				supported_endpoints: [ModelSupportedEndpoint.Messages],
				capabilities: {
					type: 'chat',
					family: 'anthropic/claude-sonnet-4',
					tokenizer: TokenizerType.O200K,
					supports: {
						parallel_tool_calls: false,
						streaming: true,
						tool_calls: true,
						vision: true,
						prediction: false,
						thinking: false
					},
					limits: {
						max_prompt_tokens: 200000,
						max_output_tokens: 16000,
						max_context_window_tokens: 200000
					}
				}
			};
		});

		it('should use Messages API when supported_endpoints includes Messages', () => {
			const endpoint = instaService.createInstance(OpenRouterEndpoint,
				anthropicMetadata,
				'test-api-key',
				'https://openrouter.ai/api/v1/messages');

			expect(endpoint.apiType).toBe('messages');
		});

	});

	describe('Non-Anthropic models — Chat Completions', () => {
		let nonAnthropicMetadata: IChatModelInformation;

		beforeEach(() => {
			nonAnthropicMetadata = {
				id: 'openai/gpt-4o',
				name: 'GPT-4o',
				vendor: 'OpenRouter',
				version: '1.0',
				model_picker_enabled: true,
				is_chat_default: false,
				is_chat_fallback: false,
				supported_endpoints: [ModelSupportedEndpoint.ChatCompletions],
				capabilities: {
					type: 'chat',
					family: 'openai/gpt-4o',
					tokenizer: TokenizerType.O200K,
					supports: {
						parallel_tool_calls: false,
						streaming: true,
						tool_calls: true,
						vision: true,
						prediction: false,
						thinking: false
					},
					limits: {
						max_prompt_tokens: 128000,
						max_output_tokens: 16000,
						max_context_window_tokens: 128000
					}
				}
			};
		});

		it('should use Chat Completions API for non-Anthropic models', () => {
			const endpoint = instaService.createInstance(OpenRouterEndpoint,
				nonAnthropicMetadata,
				'test-api-key',
				'https://openrouter.ai/api/v1/chat/completions');

			expect(endpoint.apiType).toBe('chatCompletions');
		});

		it('sends only the six newest images from user and tool messages through Arni', () => {
			const screenshots = Array.from({ length: 10 }, (_, index): Raw.ChatCompletionContentPartImage => ({
				type: Raw.ChatCompletionContentPartKind.Image,
				imageUrl: { url: `data:image/png;base64,${Buffer.from([index]).toString('base64')}` },
			}));
			const messages: Raw.ChatMessage[] = [
				{ role: Raw.ChatRole.User, content: screenshots.slice(0, 3) },
				{
					role: Raw.ChatRole.Tool,
					toolCallId: 'call_1',
					content: [
						screenshots[3],
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Browser result' },
						...screenshots.slice(4, 7),
					],
				},
				{ role: Raw.ChatRole.User, content: screenshots.slice(7) },
				{ role: Raw.ChatRole.Assistant, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Continue' }] },
			];
			const history = structuredClone(messages);
			const options: ICreateEndpointBodyOptions = {
				debugName: 'test',
				messages,
				requestId: 'request-1',
				postOptions: {},
				finishedCb: undefined,
				location: ChatLocation.Panel,
			};
			const endpoint = instaService.createInstance(OpenRouterEndpoint, nonAnthropicMetadata, 'test-api-key',
				'https://api.arnion.ru/api/chat/completions');
			const directEndpoint = instaService.createInstance(OpenRouterEndpoint, nonAnthropicMetadata, 'test-api-key',
				'https://openrouter.ai/api/v1/chat/completions');
			const images = screenshots.map(({ imageUrl }) => ({ type: 'image_url', image_url: imageUrl }));
			const note = { type: 'text', text: '[Старый скриншот удалён из истории, чтобы уложиться в лимит. Сделайте новый, если он нужен.]' };
			const toolText = { type: 'text', text: 'Browser result' };

			const arniBody = endpoint.createRequestBody(options);
			endpoint.interceptBody(arniBody);
			expect(arniBody.messages).toEqual([
				{ role: 'user', content: [note, note, note] },
				{ role: 'tool', tool_call_id: 'call_1', content: [note, toolText, ...images.slice(4, 7)] },
				{ role: 'user', content: images.slice(7) },
				{ role: 'assistant', content: 'Continue' },
			]);
			expect(messages).toEqual(history);

			const directBody = directEndpoint.createRequestBody(options);
			directEndpoint.interceptBody(directBody);
			expect(directBody.messages).toEqual([
				{ role: 'user', content: images.slice(0, 3) },
				{ role: 'tool', tool_call_id: 'call_1', content: [images[3], toolText, ...images.slice(4, 7)] },
				{ role: 'user', content: images.slice(7) },
				{ role: 'assistant', content: 'Continue' },
			]);
		});
	});
});

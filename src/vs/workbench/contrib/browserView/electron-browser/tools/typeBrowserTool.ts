/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { hash } from '../../../../../base/common/hash.js';
import { LRUCache } from '../../../../../base/common/map.js';
import {
	escapeMarkdownSyntaxTokens,
	MarkdownString
} from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { createBrowserPageLink, errorResult, getSessionId, invokeFunctionResultToToolResult, playwrightInvoke, playwrightInvokeRaw } from './browserToolHelpers.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { OpenPageToolId } from './openBrowserTool.js';

export const TypeBrowserToolData: IToolData = {
	id: 'type_in_page',
	toolReferenceName: BrowserChatToolReferenceName.TypeInPage,
	displayName: localize('typeBrowserTool.displayName', 'Type in Page'),
	userDescription: localize('typeBrowserTool.userDescription', 'Type text or press keys in a browser page'),
	modelDescription: 'Fill an exact editable element and verify its value, or press a key. Text requires a ref from the current page snapshot or a Playwright selector; element is only a display label and never locates a field. Repeated text actions without progress are blocked. Read the page after an error instead of blindly retrying.',
	icon: Codicon.symbolText,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: `The browser page ID, acquired from context or the open tool.`
			},
			text: {
				type: 'string',
				description: 'The text to type. One of "text" or "key" must be provided.'
			},
			submit: {
				type: 'boolean',
				description: 'Whether to press Enter after typing text. Ignored when "key" is provided. Default is false.'
			},
			key: {
				type: 'string',
				description: 'A key or key combination to press (e.g., "Enter", "Tab", "Control+c"). One of "text" or "key" must be provided.'
			},
			ref: {
				type: 'string',
				description: 'Element reference from the current snapshot, e.g. e46. Required for text unless selector is supplied. Do not use a ref as a CSS attribute.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of the exact editable element. Required for text unless ref is supplied. Keys alone may act on the current focus.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of the element to type into (e.g., "search box", "comment field"). Required when "ref" or "selector" is specified.'
			},
		},
		required: ['pageId']
	},
};

interface ITypeBrowserToolParams {
	pageId: string;
	text?: string;
	submit?: boolean;
	key?: string;
	ref?: string;
	selector?: string;
	element?: string;
}

export class TypeBrowserTool implements IToolImpl {
	// Keep only bounded, in-memory request counters; never retain typed values.
	private readonly attempts = new LRUCache<string, { signature: number; count: number }>(100);

	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = context.parameters as ITypeBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const hasTarget = params.ref || params.selector;

		if (params.key) {
			const key = escapeMarkdownSyntaxTokens(params.key);
			if (hasTarget && params.element) {
				const element = escapeMarkdownSyntaxTokens(params.element);
				return {
					invocationMessage: new MarkdownString(localize('browser.pressKey.invocation.element', "Pressing key `{0}` in {1} in {2}", key, element, link)),
					pastTenseMessage: new MarkdownString(localize('browser.pressKey.past.element', "Pressed key `{0}` in {1} in {2}", key, element, link)),
				};
			}
			return {
				invocationMessage: new MarkdownString(localize('browser.pressKey.invocation', "Pressing key `{0}` in {1}", key, link)),
				pastTenseMessage: new MarkdownString(localize('browser.pressKey.past', "Pressed key `{0}` in {1}", key, link)),
			};
		}

		if (hasTarget && params.element) {
			const element = escapeMarkdownSyntaxTokens(params.element);
			return {
				invocationMessage: params.submit
					? new MarkdownString(localize('browser.typeAndSubmit.invocation.element', "Typing text in {0} in {1} and pressing Enter", element, link))
					: new MarkdownString(localize('browser.type.invocation.element', "Typing text in {0} in {1}", element, link)),
				pastTenseMessage: params.submit
					? new MarkdownString(localize('browser.typeAndSubmit.past.element', "Typed text in {0} in {1} and pressed Enter", element, link))
					: new MarkdownString(localize('browser.type.past.element', "Typed text in {0} in {1}", element, link)),
			};
		}
		return {
			invocationMessage: params.submit
				? new MarkdownString(localize('browser.typeAndSubmit.invocation', "Typing text in {0} and pressing Enter", link))
				: new MarkdownString(localize('browser.type.invocation', "Typing text in {0}", link)),
			pastTenseMessage: params.submit
				? new MarkdownString(localize('browser.typeAndSubmit.past', "Typed text in {0} and pressed Enter", link))
				: new MarkdownString(localize('browser.type.past', "Typed text in {0}", link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as ITypeBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		let selector = params.selector;
		if (params.ref) {
			selector = `aria-ref=${params.ref}`;
		}

		if (token.isCancellationRequested) {
			return errorResult('Browser input cancelled.');
		}
		if ((typeof params.text !== 'string' && !params.key) || (params.text !== undefined && params.key !== undefined)) {
			return errorResult('Provide either "text" (including an empty string to clear a field) or "key", not both.');
		}

		// Press key
		if (params.key) {
			if (selector) {
				return playwrightInvoke(this.playwrightService, sessionId, params.pageId, (page, sel, key) => page.locator(sel).press(key), selector, params.key);
			}
			return playwrightInvoke(this.playwrightService, sessionId, params.pageId, (page, key) => page.keyboard.press(key), params.key);
		}

		const scope = JSON.stringify([sessionId, invocation.chatRequestId ?? invocation.callId]);
		const signature = hash([params.pageId, params.ref, params.selector, params.text, params.submit]);
		const previous = this.attempts.get(scope);
		const attempt = previous?.signature === signature ? previous : { signature, count: 0 };
		if (attempt.count >= 2) {
			return { ...errorResult('Repeated browser input without verified progress is blocked. Stop this attempt, explain the failure and ask the user before trying it again.'),
				stopCurrentTurn: true, toolResultMessage: localize('browser.repeatedInputStopped', 'Остановлено: повторный ввод без подтверждённого результата') };
		}
		attempt.count++;
		this.attempts.set(scope, attempt);
		if (!selector || (params.ref !== undefined && !/^e\d+$/.test(params.ref))) {
			return errorResult('Text input requires an exact ref from the current snapshot (e.g. ref:"e46") or a Playwright selector. The element description does not select a field. Read the page and locate the field; no text was typed.');
		}
		try {
			const result = await playwrightInvokeRaw(this.playwrightService, sessionId, params.pageId, async (page, sel, text, submit) => {
				const locator = page.locator(sel);
				const readValue = () => locator.evaluate(element => {
					if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
						return (element as HTMLInputElement | HTMLTextAreaElement).value;
					}
					if ((element as HTMLElement).isContentEditable) {
						return element.textContent ?? '';
					}
					throw new Error('The target is not a text field. Use an editable input, textarea or contenteditable element.');
				});
				const before = await readValue();
				await locator.fill(text);
				const after = await readValue();
				if (after !== text) {
					throw new Error('The field value did not match after filling. Read the page and resolve validation or formatting before continuing.');
				}
				// Do not press Enter again when a repeated call found the value already set.
				if (submit && before !== after) {
					await locator.press('Enter');
				}
				return { verified: true, changed: before !== after };
			}, selector, params.text!, params.submit ?? false);
			if (result.changed) {
				this.attempts.delete(scope);
			}
			return invokeFunctionResultToToolResult({ result, summary: await this.playwrightService.getSummary(sessionId, params.pageId) });
		} catch (error) {
			return errorResult(`${error instanceof Error ? error.message : String(error)}\nInput was not verified. Read the current page before retrying; the field may have changed.`);
		}
	}
}

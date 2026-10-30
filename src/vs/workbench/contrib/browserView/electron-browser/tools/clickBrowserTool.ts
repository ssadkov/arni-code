/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { hash } from '../../../../../base/common/hash.js';
import { escapeMarkdownSyntaxTokens, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { createBrowserPageLink, DEFAULT_ELEMENT_LABEL, errorResult, getSessionId, playwrightInvoke } from './browserToolHelpers.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { OpenPageToolId } from './openBrowserTool.js';
import { IBrowserToolProgress } from './browserToolProgress.js';

export const ClickBrowserToolData: IToolData = {
	id: 'click_element',
	toolReferenceName: BrowserChatToolReferenceName.ClickElement,
	displayName: localize('clickBrowserTool.displayName', 'Click Element'),
	userDescription: localize('clickBrowserTool.userDescription', 'Click an element in a browser page'),
	modelDescription: 'Click an exact element using ref from the latest page snapshot (e.g. ref:"e33") or a Playwright selector. element is only a label, never a locator. Refresh the page after a stale-ref error; repeated failed or unchanged clicks stop the turn.',
	icon: Codicon.cursor,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: `The browser page ID, acquired from context or the open tool.`
			},
			ref: {
				type: 'string',
				description: 'Element reference to click.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of the element to click when "ref" is not available.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of the element to click (e.g., "submit button", "search icon").'
			},
			dblClick: {
				type: 'boolean',
				description: 'Set to true for double clicks. Default is false.'
			},
			button: {
				type: 'string',
				enum: ['left', 'right', 'middle'],
				description: 'Mouse button to click with. Default is "left".'
			},
		},
		required: ['pageId', 'element'],
		$comment: 'One of "ref" or "selector" is required.',
	},
};

interface IClickBrowserToolParams {
	pageId: string;
	ref?: string;
	selector?: string;
	element?: string;
	dblClick?: boolean;
	button?: 'left' | 'right' | 'middle';
}

export class ClickBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
		@IBrowserToolProgress private readonly browserProgress: IBrowserToolProgress,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IClickBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const element = escapeMarkdownSyntaxTokens(params.element ?? DEFAULT_ELEMENT_LABEL);
		return {
			invocationMessage: params.button === 'right'
				? new MarkdownString(localize('browser.click.invocation.right', "Right-clicking {0} in {1}", element, link))
				: params.button === 'middle'
					? new MarkdownString(localize('browser.click.invocation.middle', "Middle-clicking {0} in {1}", element, link))
					: params.dblClick
						? new MarkdownString(localize('browser.dblClick.invocation', "Double-clicking {0} in {1}", element, link))
						: new MarkdownString(localize('browser.click.invocation', "Clicking {0} in {1}", element, link)),
			pastTenseMessage: params.button === 'right'
				? new MarkdownString(localize('browser.click.past.right', "Right-clicked {0} in {1}", element, link))
				: params.button === 'middle'
					? new MarkdownString(localize('browser.click.past.middle', "Middle-clicked {0} in {1}", element, link))
					: params.dblClick
						? new MarkdownString(localize('browser.dblClick.past', "Double-clicked {0} in {1}", element, link))
						: new MarkdownString(localize('browser.click.past', "Clicked {0} in {1}", element, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		if (_token.isCancellationRequested) { return errorResult('Browser click cancelled.'); }
		const params = invocation.parameters as IClickBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}
		const signature = hash([params.ref, params.selector, params.button, params.dblClick]);
		const stopped = this.browserProgress.begin(invocation, 'click', params.pageId, signature);
		if (stopped) { return stopped; }

		let selector = params.selector;
		if (params.ref) {
			selector = `aria-ref=${params.ref}`;
		}

		if (!selector || (params.ref !== undefined && !/^e\d+$/.test(params.ref))) {
			return errorResult('Click requires ref from the latest snapshot (e.g. ref:"e33") or an exact Playwright selector. element is only a description. No click was performed.');
		}

		const button = params.button ?? 'left';

		try {
			const before = await this.playwrightService.getSummary(sessionId, params.pageId);
			const result = params.dblClick
				? await playwrightInvoke(this.playwrightService, sessionId, params.pageId, (page, sel, btn) => page.locator(sel).dblclick({ button: btn }), selector, button)
				: await playwrightInvoke(this.playwrightService, sessionId, params.pageId, (page, sel, btn) => page.locator(sel).click({ button: btn }), selector, button);
			const after = await this.playwrightService.getSummary(sessionId, params.pageId);
			if (!result.toolResultError && !this.browserProgress.samePage(before, after)) {
				this.browserProgress.changed(invocation, 'click', params.pageId, signature);
			}
			return result.toolResultError ? result : { ...result, content: [{ kind: 'text', value: after }] };
		} catch (error) {
			return errorResult(`${error instanceof Error ? error.message : String(error)}\nRead the current page before another click; do not repeat a stale ref.`);
		}
	}
}

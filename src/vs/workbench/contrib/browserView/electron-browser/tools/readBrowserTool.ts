/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { createBrowserPageLink, errorResult, getSessionId } from './browserToolHelpers.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { OpenPageToolId } from './openBrowserTool.js';
import { IBrowserToolProgress } from './browserToolProgress.js';

export const ReadBrowserToolData: IToolData = {
	id: 'read_page',
	toolReferenceName: BrowserChatToolReferenceName.ReadPage,
	displayName: localize('readBrowserTool.displayName', 'Read Page'),
	userDescription: localize('readBrowserTool.userDescription', 'Read the content of a browser page'),
	modelDescription: 'Get a snapshot of the current browser page state. Use its ref values for clicks and text input. Do not keep reading the same unchanged page: repeated reads stop the turn. If a Start/Next button is visible, inspect it and use its current ref to open the questions.',
	icon: Codicon.fileText,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: `The browser page ID to read, acquired from context or the open tool.`
			},
		},
		required: ['pageId'],
	},
};

interface IReadBrowserToolParams {
	pageId: string;
}

export class ReadBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
		@IBrowserToolProgress private readonly browserProgress: IBrowserToolProgress,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const link = createBrowserPageLink(_context.parameters.pageId);
		return {
			invocationMessage: new MarkdownString(localize('browser.read.invocation', "Reading {0}", link)),
			pastTenseMessage: new MarkdownString(localize('browser.read.past', "Read {0}", link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		if (_token.isCancellationRequested) { return errorResult('Browser read cancelled.'); }
		const params = invocation.parameters as IReadBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const summary = await this.playwrightService.getSummary(sessionId, params.pageId);
		if (!summary) {
			return errorResult('No page summary available.');
		}
		const stopped = this.browserProgress.read(invocation, params.pageId, summary);
		if (stopped) { return stopped; }

		return {
			content: [{
				kind: 'text',
				value: summary,
			}],
		};
	}
}

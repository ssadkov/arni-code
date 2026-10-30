/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { getArniAgentIdentity, getArniConversationParticipants, getArniResponseAuthor, getArniResponseParticipants, resolveArniAgentAlias } from '../../../common/arniAgentIdentity.js';
import { renderArniAgentIdentity } from '../../../browser/widget/arniAgentIdentityWidget.js';
import { IChatToolInvocationSerialized } from '../../../common/chatService/chatService.js';
import { IChatProgressResponseContent, IChatRequestModel, IChatResponseModel, IResponse } from '../../../common/model/chatModel.js';
import { ChatModeKind } from '../../../common/constants.js';

suite('Arni agent identity', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('materialized profession aliases resolve only when unique; unrelated profiles are not guessed', () => {
		const source = 'file:///bundled/agents/researcher.agent.md';
		const hosted = { uri: 'file:///synced-plugin/agents/researcher.agent.md', name: 'researcher' };
		assert.strictEqual(resolveArniAgentAlias([hosted], source), hosted);
		assert.strictEqual(resolveArniAgentAlias([hosted, { ...hosted, uri: 'file:///project/agents/researcher.agent.md' }], source), undefined);
		assert.strictEqual(resolveArniAgentAlias([hosted], 'file:///other/agents/custom.agent.md'), undefined);
	});
	function response(name: string, parts: IChatProgressResponseContent[] = [{ kind: 'markdownContent', content: new MarkdownString('Done') }]): Pick<IChatResponseModel, 'request' | 'response'> {
		return {
			request: upcastPartial<IChatRequestModel>({ modeInfo: { kind: ChatModeKind.Agent, isBuiltin: false, modeInstructions: { name, content: '', toolReferences: [] }, telemetryModeId: 'custom', applyCodeBlockSuggestionId: undefined } }),
			response: upcastPartial<IResponse>({ value: parts }),
		};
	}
	function subagent(name: string, startedAt?: number): IChatToolInvocationSerialized {
		return upcastPartial<IChatToolInvocationSerialized>({ kind: 'toolInvocationSerialized', toolSpecificData: { kind: 'subagent', agentName: name, startedAt } });
	}

	test('stable file identity wins over a changed label; unknown agents keep existing rendering', () => {
		assert.deepStrictEqual([
			getArniAgentIdentity('Секретарь', 'file:///skills/agents/sysadmin.agent.md')?.id,
			getArniAgentIdentity('video-editor')?.icon.id,
			getArniAgentIdentity('A custom role'),
		], ['sysadmin', 'device-camera-video', undefined]);
	});

	test('a picker change or a mention cannot relabel previous responses or imply participation', () => {
		const first = response('Монтажёр');
		const second = response('Сисадмин', [{ kind: 'markdownContent', content: new MarkdownString('Later we may ask Секретарь.') }, subagent('secretary')]);
		assert.deepStrictEqual({
			first: getArniResponseAuthor(first)?.name,
			second: getArniResponseAuthor(second)?.name,
			participants: getArniConversationParticipants([first, second]).map(agent => agent.name),
		}, { first: 'Монтажёр', second: 'Сисадмин', participants: ['Монтажёр', 'Сисадмин'] });
		assert.strictEqual(getArniResponseAuthor(response('Сисадмин', [])), undefined);
		const terminal = { ...response('Сисадмин'), request: upcastPartial<IChatRequestModel>({ ...response('Сисадмин').request, isTerminalCommand: true }) };
		assert.strictEqual(getArniResponseAuthor(terminal), undefined);
	});

	test('provider-started subagents are deduplicated and an absent historical role is not guessed', () => {
		const data = response('Сисадмин', [subagent('video-editor', 1000), subagent('video-editor', 1001), subagent('secretary')]);
		assert.deepStrictEqual(getArniResponseParticipants(data).map(agent => agent.id), ['sysadmin', 'video-editor']);
		const legacy = { ...response('Unknown'), request: undefined };
		assert.strictEqual(getArniResponseAuthor(legacy), undefined);
	});

	test('renders named icons and conversation participants accessibly; clears recycled rows', () => {
		const container = mainWindow.document.createElement('div');
		const admin = getArniAgentIdentity('Сисадмин')!;
		const editor = getArniAgentIdentity('Монтажёр')!;
		renderArniAgentIdentity(container, admin, [editor, admin]);
		assert.deepStrictEqual({
			author: container.querySelector('.arni-response-author')?.textContent,
			participants: [...container.querySelectorAll('.arni-conversation-participants .arni-agent-badge')].map(node => node.textContent),
			iconHidden: container.querySelector('.codicon-tools')?.getAttribute('aria-hidden'),
			hidden: container.hidden,
		}, { author: 'Отвечает:Сисадмин', participants: ['Монтажёр', 'Сисадмин'], iconHidden: 'true', hidden: false });
		renderArniAgentIdentity(container, admin, [admin]);
		assert.strictEqual(container.querySelector('.arni-conversation-participants'), null);
		renderArniAgentIdentity(container, undefined, []);
		assert.deepStrictEqual({ hidden: container.hidden, content: container.textContent }, { hidden: true, content: '' });
	});

	test('frozen request URI provides an icon even if a historical display name differs', () => {
		const previous = response('My edited title');
		const data = { ...previous, request: upcastPartial<IChatRequestModel>({ modeInfo: { ...previous.request!.modeInfo!, modeInstructions: { name: 'My edited title', uri: URI.parse('file:///workspace/.github/agents/sysadmin.agent.md'), content: '', toolReferences: [] } } }) };
		assert.strictEqual(getArniResponseAuthor(data)?.icon.id, 'tools');
	});
});

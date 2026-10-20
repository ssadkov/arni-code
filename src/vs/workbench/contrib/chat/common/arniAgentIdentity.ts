/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import type { IChatResponseModel } from './model/chatModel.js';

export interface IArniAgentIdentity {
	readonly id: string;
	readonly name: string;
	readonly icon: ThemeIcon;
}

const professions: readonly IArniAgentIdentity[] = [
	{ id: 'sysadmin', name: 'Сисадмин', icon: Codicon.tools },
	{ id: 'video-editor', name: 'Монтажёр', icon: Codicon.deviceCameraVideo },
	{ id: 'secretary', name: 'Секретарь', icon: Codicon.notebook },
	{ id: 'content-editor', name: 'Контент-редактор', icon: Codicon.edit },
];

/** Stable first-party role identity, shared by the picker and historical response rendering. */
export function getArniAgentIdentity(name: string | undefined, uri?: string): IArniAgentIdentity | undefined {
	let file: string | undefined;
	try { file = uri ? URI.parse(uri).path.split('/').at(-1)?.replace(/\.agent\.md$/, '') : undefined; } catch { /* Unknown URI: keep the explicit name lookup. */ }
	return professions.find(agent => agent.id === file) ?? professions.find(agent => agent.name === name || agent.id === name);
}

/** Never consults the current picker: a response belongs to its frozen request. */
export function getArniResponseAuthor(response: Pick<IChatResponseModel, 'request' | 'response'>): IArniAgentIdentity | undefined {
	if (response.request?.isTerminalCommand || !response.response.value.some(part =>
		part.kind === 'markdownContent' && !!part.content.value.trim()
		|| part.kind === 'thinking' && !!part.value
		|| part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized')) {
		return undefined;
	}
	const instructions = response.request?.modeInfo?.modeInstructions;
	return getArniAgentIdentity(instructions?.name, instructions?.uri?.toString());
}

/** Subagents count only after provider-reported start, not a streamed proposal or a mention in prose. */
export function getArniResponseParticipants(response: Pick<IChatResponseModel, 'request' | 'response'>): readonly IArniAgentIdentity[] {
	const participants = new Map<string, IArniAgentIdentity>();
	const author = getArniResponseAuthor(response);
	if (author) { participants.set(author.id, author); }
	for (const part of response.response.value) {
		if (part.kind !== 'toolInvocation' && part.kind !== 'toolInvocationSerialized') { continue; }
		const data = part.toolSpecificData;
		if (data?.kind !== 'subagent' || typeof data.startedAt !== 'number' || !Number.isFinite(data.startedAt)) { continue; }
		const agent = getArniAgentIdentity(data.agentDisplayName ?? data.agentName) ?? getArniAgentIdentity(data.agentName);
		if (agent) { participants.set(agent.id, agent); }
	}
	return [...participants.values()];
}

export function getArniConversationParticipants(responses: readonly Pick<IChatResponseModel, 'request' | 'response'>[]): readonly IArniAgentIdentity[] {
	const participants = new Map<string, IArniAgentIdentity>();
	for (const response of responses) {
		for (const agent of getArniResponseParticipants(response)) { participants.set(agent.id, agent); }
	}
	return [...participants.values()];
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import type { IChatResponseModel } from './model/chatModel.js';
import { localize } from '../../../../nls.js';

export interface IArniAgentIdentity {
	readonly id: string;
	readonly name: string;
	readonly icon: ThemeIcon;
	readonly whenToChoose: string;
}

const professions: readonly IArniAgentIdentity[] = [
	{ id: 'programmer', name: 'Программист', icon: Codicon.code, whenToChoose: localize('arniAgent.programmer.whenToChoose', "Разобрать репозиторий, сделать или исправить сайт") },
	{ id: 'researcher', name: 'Исследователь', icon: Codicon.search, whenToChoose: localize('arniAgent.researcher.whenToChoose', "Найти информацию, сравнить источники, разобрать книгу") },
	{ id: 'data-analyst', name: 'Аналитик', icon: Codicon.table, whenToChoose: localize('arniAgent.dataAnalyst.whenToChoose', "Сверить Excel/CSV, разобрать данные и суммы") },
	{ id: 'presentation-designer', name: 'Дизайнер презентаций', icon: Codicon.preview, whenToChoose: localize('arniAgent.presentationDesigner.whenToChoose', "Создать или отредактировать презентацию") },
	{ id: 'file-organizer', name: 'Архивариус', icon: Codicon.folderOpened, whenToChoose: localize('arniAgent.fileOrganizer.whenToChoose', "Разобрать файлы по проверенному плану") },
	{ id: 'instructional-designer', name: 'Методист', icon: Codicon.book, whenToChoose: localize('arniAgent.instructionalDesigner.whenToChoose', "Создать урок и задания для самопроверки") },
	{ id: 'sysadmin', name: 'Сисадмин', icon: Codicon.tools, whenToChoose: localize('arniAgent.sysadmin.whenToChoose', "Проверить компьютер, диски и автозагрузку") },
	{ id: 'video-editor', name: 'Монтажёр', icon: Codicon.deviceCameraVideo, whenToChoose: localize('arniAgent.videoEditor.whenToChoose', "Обрезать видео, заменить фон, добавить субтитры") },
	{ id: 'secretary', name: 'Секретарь', icon: Codicon.notebook, whenToChoose: localize('arniAgent.secretary.whenToChoose', "Работать с личными данными и заполнять формы") },
	{ id: 'content-editor', name: 'Контент-редактор', icon: Codicon.edit, whenToChoose: localize('arniAgent.contentEditor.whenToChoose', "Написать или улучшить тексты и посты") },
];

/** Stable first-party role identity, shared by the picker and historical response rendering. */
export function getArniAgentIdentity(name: string | undefined, uri?: string): IArniAgentIdentity | undefined {
	let file: string | undefined;
	try { file = uri ? URI.parse(uri).path.split('/').at(-1)?.replace(/\.agent\.md$/, '') : undefined; } catch { /* Unknown URI: keep the explicit name lookup. */ }
	return professions.find(agent => agent.id === file) ?? professions.find(agent => agent.name === name || agent.id === name);
}

/** A host may materialize the bundled profile at a new URI and use its filename as name. */
export function resolveArniAgentAlias<T extends { readonly name: string; readonly uri: string }>(agents: readonly T[], selectedUri: string): T | undefined {
	const profession = getArniAgentIdentity(undefined, selectedUri);
	if (!profession) { return undefined; }
	const candidates = agents.filter(agent => getArniAgentIdentity(agent.name, agent.uri)?.id === profession.id);
	return candidates.length === 1 ? candidates[0] : undefined;
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

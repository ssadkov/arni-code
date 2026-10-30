/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { localize } from '../../../../../nls.js';
import { IArniAgentIdentity } from '../../common/arniAgentIdentity.js';

/** Quiet, text-labelled author/participant strip; no interactive targets or image downloads. */
export function renderArniAgentIdentity(container: HTMLElement, author: IArniAgentIdentity | undefined, participants: readonly IArniAgentIdentity[]): void {
	clearNode(container);
	container.hidden = !author && participants.length === 0;
	if (container.hidden) { return; }
	if (author) {
		const row = append(container, $('.arni-response-author'));
		append(row, $('span.arni-agent-caption', undefined, localize('arni.response.author', 'Отвечает:')));
		renderAgent(row, author);
	}
	if (participants.length > 1 || (!author && participants.length > 0)) {
		const row = append(container, $('.arni-conversation-participants'));
		append(row, $('span.arni-agent-caption', undefined, localize('arni.response.participants', 'Участвовали в диалоге:')));
		for (const agent of participants) { renderAgent(row, agent); }
	}
}

function renderAgent(container: HTMLElement, agent: IArniAgentIdentity): void {
	const badge = append(container, $('span.arni-agent-badge'));
	badge.dataset.agentId = agent.id;
	const icon = append(badge, renderIcon(agent.icon));
	icon.setAttribute('aria-hidden', 'true');
	append(badge, $('span', undefined, agent.name));
}

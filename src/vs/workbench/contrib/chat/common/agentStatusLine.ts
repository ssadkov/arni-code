/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * One status line for the Agents window. Raw provider and tool errors stay
 * off this screen; the caller shows {@link AgentStatusDecision} instead.
 */
export type AgentStatusDecision = { readonly kind: 'keep' } | { readonly kind: 'replace'; readonly text: string } | { readonly kind: 'hide' };

const FILE_NAME = /[\w.-]+\.[A-Za-z0-9]{1,8}/;

export function decideAgentStatus(message: string): AgentStatusDecision {
	const text = message.replace(/\s+/g, ' ').trim();
	if (!text) {
		return { kind: 'hide' };
	}

	if (/file already exists/i.test(text)) {
		return { kind: 'replace', text: 'файл уже был, обновляю' };
	}

	if (/github login|sign in to github|copilot sdk|waiting for copilot/i.test(text)) {
		return { kind: 'hide' };
	}

	if (/quota|rate limit|free requests|remaining/i.test(text) && /\b0\b|exceed|limit|кончил/i.test(text)) {
		return { kind: 'replace', text: 'Бесплатные запросы на сегодня кончились. Снова в 05:00.' };
	}

	if (/nemotron/i.test(text) && /not respond|unavailable|timed out|timeout|empty response|abort|failed|error/i.test(text)) {
		return { kind: 'replace', text: 'Nemotron не отвечает, переключить на North Mini?' };
	}

	const retry = text.match(/(\d+)\s*(?:of|из|\/)\s*(\d+)/i);
	if (/retry|attempt|повтор|оборвал/i.test(text) || (retry && /model|stream|response|модель/i.test(text))) {
		const current = retry?.[1] ?? '1';
		const total = retry?.[2] ?? '2';
		return { kind: 'replace', text: `Модель оборвалась, повторяю ${current} из ${total}…` };
	}

	if (/\b(creat\w*|writ\w*|edit\w*|sav\w*|patch\w*)\b/i.test(text) && /\bfile\b|файл|\.[a-z0-9]{1,8}\b/i.test(text)) {
		const file = text.match(FILE_NAME);
		return { kind: 'replace', text: file ? `Пишу ${file[0]}…` : 'Пишу файл…' };
	}

	if (/\bread(?:ing)?\b/i.test(text) && (/\bfile\b/i.test(text) || FILE_NAME.test(text))) {
		return { kind: 'replace', text: 'Читаю файл…' };
	}

	if (/waiting for tool|thinking|planning|\bworking\b/i.test(text)) {
		return { kind: 'replace', text: 'Думаю…' };
	}

	if (/\b(done|complete|finished|created)\b/i.test(text) && /\bfile\b|файл/i.test(text)) {
		return { kind: 'replace', text: 'Готово. Файл в папке.' };
	}

	return { kind: 'keep' };
}

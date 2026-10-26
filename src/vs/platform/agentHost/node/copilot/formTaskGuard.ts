/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isObject } from '../../../../base/common/types.js';

/** Bounds source gathering for a user-supplied Google Form; never grants tool access. */
export class FormTaskGuard {
	private _url: string | undefined;
	private _prompt = '';
	private _pageId: string | undefined;
	private _inspected = false;
	private _reads = 0;
	private _denials = 0;
	private _questionHeadings = '';

	start(prompt: string, browserAvailable: boolean): void {
		this._url = undefined;
		this._pageId = undefined;
		this._inspected = false;
		this._prompt = prompt;
		this._questionHeadings = '';
		this.resetTurn();
		if (!browserAvailable || !/\b(?:fill|draft|prepare|application|apply)\b|заполн|заявк|черновик|подготов/iu.test(prompt.replace(/https:\/\/\S+/g, ''))) { return; }
		for (const candidate of prompt.match(/https:\/\/[^\s<>"'\])]+/g) ?? []) {
			try {
				const url = new URL(candidate);
				if (url.hostname === 'forms.gle' || (url.hostname === 'docs.google.com' && url.pathname.startsWith('/forms/'))) {
					this._url = url.href;
					break;
				}
			} catch { /* Ignore malformed links. */ }
		}
	}

	resetTurn(): void {
		this._reads = 0;
		this._denials = 0;
	}

	get stopped(): boolean { return this._denials >= 3; }

	static isContinuation(prompt: string): boolean {
		return /^\s*(?:продолж(?:и|ай|им)|continue|resume)(?:\s|$|[.!])/iu.test(prompt);
	}

	/** Reuse public form observations on an explicit continuation after a restart. */
	restore(events: readonly { type: string; data: unknown }[], browserAvailable: boolean): void {
		let start = -1;
		for (let i = events.length - 1; i >= 0; i--) {
			const data = events[i].data;
			if (events[i].type !== 'user.message' || !isObject(data) || typeof data.content !== 'string') { continue; }
			if (FormTaskGuard.isContinuation(data.content)) { continue; }
			this.start(data.content, browserAvailable);
			start = i;
			break;
		}
		if (!this._url || start < 0) { return; }
		const calls = new Map<string, { name: string; args: unknown }>();
		for (const event of events.slice(start + 1)) {
			const data = event.data;
			if (!isObject(data) || typeof data.toolCallId !== 'string') { continue; }
			if (event.type === 'tool.execution_start' && typeof data.toolName === 'string') {
				if (['openBrowserPage', 'readPage', 'view'].includes(data.toolName)) { calls.set(data.toolCallId, { name: data.toolName, args: data.arguments }); }
			} else if (event.type === 'tool.execution_complete' && data.success === true && isObject(data.result)) {
				const call = calls.get(data.toolCallId);
				const text = data.result.detailedContent ?? data.result.content;
				if (call && typeof text === 'string') { this.afterTool(call.name, call.args, true, text); }
			}
		}
	}

	/** Narrow a form's profile request using observed question labels, never profile values. */
	profileArguments(args: unknown): Record<string, unknown> | undefined {
		if (!this._url || !this._inspected || !isObject(args) || args.metadataOnly || args.allFields || !Array.isArray(args.fields)) { return undefined; }
		const rules: readonly [string, RegExp][] = [
			['firstName', /founder name|your name|full name|first name|имя/iu],
			['lastName', /founder name|your name|full name|last name|фамил/iu],
			['email', /email|e-mail|электронн/iu], ['phone', /phone|телефон/iu],
			['country', /country|страна|страны/iu], ['city', /\bcity\b|город/iu],
			['companyName', /company name|organization|название организации/iu], ['jobTitle', /job title|должност/iu],
			['website', /personal website|your website|личный сайт/iu],
			['bio', /proof of work|biograph|\bbio\b|биограф/iu],
			['telegram', /telegram|телеграм/iu], ['twitter', /twitter|\bx\b/iu],
		];
		const known = new Set([...rules.map(([field]) => field), 'firstNameLatin', 'lastNameLatin', 'companyBin']);
		if (!args.fields.every(field => typeof field === 'string' && known.has(field))) { return undefined; }
		const fields = rules.filter(([, pattern]) => pattern.test(this._questionHeadings)).map(([field]) => field);
		if (!fields.length) { return undefined; }
		return { ...args, fields, destination: this._url };
	}

	beforeTool(name: string, args: unknown): string | undefined {
		if (!this._url) { return undefined; }
		const skill = name === 'skill' && isObject(args) && typeof args.skill === 'string' ? args.skill : undefined;
		if (skill && this._prompt.toLowerCase().includes(skill.toLowerCase())) {
			// A user-selected workflow takes precedence over this inferred one.
			this._url = undefined;
			return undefined;
		}
		const read = ['view', 'grep', 'glob', 'readFile', 'fileSearch', 'textSearch'].includes(name);
		let reason: string | undefined;
		if (skill) {
			reason = 'The supplied form defines this application. Do not automatically load a different program\'s skill or export a session transcript. Inspect the form questions and prepare the requested answers directly; the user has not requested this skill.';
		} else if (['powershell', 'bash', 'shell'].includes(name)) {
			reason = 'For this form task use browser tools, repository readers and the user-profile tool. Do not run terminal setup, telemetry or transcript-export workflows. If a required capability is unavailable, explain the blocker.';
		} else if (read && !this._inspected) {
			reason = `First open the supplied form ${this._url} with openBrowserPage, then use readPage on that page. Read its questions before collecting project facts. If login or a browser limitation blocks access, explain that blocker instead of reading unrelated files.`;
		} else if (read && ++this._reads > 10) {
			reason = 'The form task has already used ten source-reading/search calls in this turn. Stop gathering documentation. Draft answers to the observed questions using the facts already read and identify only genuinely missing information. Do not continue reading sequential file ranges.';
		}
		if (reason) { this._denials++; }
		return reason;
	}

	afterTool(name: string, args: unknown, success: boolean, text: string): void {
		if (!this._url || !success || !isObject(args)) { return; }
		if (name === 'openBrowserPage' && args.url === this._url) {
			this._pageId = /Page ID: ([^\s]+)/.exec(text)?.[1];
		} else if (name === 'readPage' && this._pageId && args.pageId === this._pageId && text.trim()) {
			this._inspected = true;
		}
		if (this._inspected && (name === 'readPage' || name === 'view')) {
			this._questionHeadings += '\n' + text.split('\n').filter(line => /\bheading\b.*\[level=3\]/.test(line)).join('\n');
		}
	}
}

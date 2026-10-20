/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hash } from '../../../../../base/common/hash.js';
import { LRUCache } from '../../../../../base/common/map.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { localize } from '../../../../../nls.js';
import { IToolInvocation, IToolResult } from '../../../chat/common/tools/languageModelToolsService.js';
import { errorResult, getSessionId } from './browserToolHelpers.js';

export const IBrowserToolProgress = createDecorator<IBrowserToolProgress>('browserToolProgress');

export interface IBrowserToolProgress {
	readonly _serviceBrand: undefined;
	begin(invocation: IToolInvocation, action: string, pageId: string, signature: number): IToolResult | undefined;
	changed(invocation: IToolInvocation, action: string, pageId: string, signature: number): void;
	read(invocation: IToolInvocation, pageId: string, summary: string): IToolResult | undefined;
	samePage(before: string, after: string): boolean;
}

/** Per-user-request guards shared by browser reads, clicks and text input. No page values are retained. */
export class BrowserToolProgress implements IBrowserToolProgress {
	declare readonly _serviceBrand: undefined;
	private readonly attempts = new LRUCache<string, number>(1000);
	private readonly snapshots = new LRUCache<string, { fingerprint: number; count: number }>(1000);

	private key(invocation: IToolInvocation, pageId: string): string {
		return JSON.stringify([getSessionId(invocation), invocation.chatRequestId ?? invocation.callId, pageId]);
	}
	private fingerprint(summary: string): number {
		// Console timestamps, snapshot refs and focus alone do not establish page progress.
		const snapshot = summary.includes('Snapshot:') ? summary.slice(summary.indexOf('Snapshot:')) : summary;
		const location = summary.match(/^(?:Page Title|URL):.*$/gm)?.join('\n') ?? '';
		return hash(location + '\n' + snapshot.replace(/\s*\[(?:ref=e\d+|active|focused)\]/g, '').trim());
	}
	private stopped(): IToolResult {
		return { ...errorResult('Repeated browser action without verified progress is blocked. Explain the stop and wait for a new user message. Do not retry through a different tool.'),
			stopCurrentTurn: true, toolResultMessage: localize('browser.progressStopped', 'Остановлено: повторные действия в браузере без результата') };
	}
	begin(invocation: IToolInvocation, action: string, pageId: string, signature: number): IToolResult | undefined {
		const key = `${this.key(invocation, pageId)}:${action}:${signature}`;
		const count = this.attempts.get(key) ?? 0;
		if (count >= 2) { return this.stopped(); }
		this.attempts.set(key, count + 1);
		return undefined;
	}
	changed(invocation: IToolInvocation, action: string, pageId: string, signature: number): void {
		const key = this.key(invocation, pageId);
		this.attempts.delete(`${key}:${action}:${signature}`);
		this.snapshots.delete(key);
	}
	read(invocation: IToolInvocation, pageId: string, summary: string): IToolResult | undefined {
		const key = this.key(invocation, pageId);
		const fingerprint = this.fingerprint(summary);
		const previous = this.snapshots.get(key);
		const count = previous?.fingerprint === fingerprint ? previous.count + 1 : 1;
		this.snapshots.set(key, { fingerprint, count });
		return count > 2 ? this.stopped() : undefined;
	}
	samePage(before: string, after: string): boolean { return this.fingerprint(before) === this.fingerprint(after); }
}

registerSingleton(IBrowserToolProgress, BrowserToolProgress, InstantiationType.Delayed);

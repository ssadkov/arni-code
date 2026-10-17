/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../../base/common/network.js';
import { basename, extname } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import * as dom from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';

/** Local formats the integrated Chromium player can preview (subject to codec support). */
export const chatMediaExtensions = ['mp4', 'webm', 'm4v', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac'] as const;

export function isChatMediaResource(resource: URI): boolean {
	return resource.scheme === Schemas.file && !resource.authority
		&& chatMediaExtensions.some(extension => extname(resource).toLowerCase() === `.${extension}`);
}

/** Only a whole absolute local path/URI counts; never interpret shell commands or web URLs as files. */
export function parseChatMediaResource(text: string): URI | undefined {
	const value = text.trim();
	let resource: URI;
	try {
		if (value.toLowerCase().startsWith('file:')) {
			resource = URI.parse(value);
		} else if (/^[a-z]:[\\/]/i.test(value) || /^\/(?!\/)/.test(value)) {
			resource = URI.file(value.replace(/\\/g, '/'));
		} else {
			return undefined;
		}
	} catch {
		return undefined;
	}
	return isChatMediaResource(resource) ? resource : undefined;
}

/** Convert complete output paths to explicit playback actions, without loading files during rendering. */
export function renderChatMediaPreviews(element: HTMLElement, hoverService: Pick<IHoverService, 'setupManagedHover'>, onOpen: (resource: URI) => void): IDisposable {
	const store = new DisposableStore();
	for (const node of element.querySelectorAll('code, a[data-href]')) {
		if (node.closest('pre') || (node.tagName === 'CODE' && node.closest('a'))) {
			continue;
		}
		const resource = parseChatMediaResource(node.tagName === 'A' ? node.getAttribute('data-href') ?? '' : node.textContent ?? '');
		if (!resource) {
			continue;
		}
		const container = dom.$('span.chat-media-preview');
		const button = store.add(new Button(container, { secondary: true }));
		button.icon = Codicon.play;
		button.label = localize('chat.media.openPlayer', "Play {0}", basename(resource));
		store.add(hoverService.setupManagedHover(getDefaultHoverDelegate('element'), button.element, resource.fsPath));
		store.add(button.onDidClick(() => onOpen(resource)));
		node.replaceWith(container);
	}
	return store;
}

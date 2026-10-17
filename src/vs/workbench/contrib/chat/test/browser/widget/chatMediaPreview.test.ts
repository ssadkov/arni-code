/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { BrowserViewEditorId } from '../../../../browserView/common/browserView.js';
import { ChatConfiguration } from '../../../common/constants.js';
import { getEditorOverrideForChatResource } from '../../../browser/widget/chatEditorAssociations.js';
import { isChatMediaResource, parseChatMediaResource, renderChatMediaPreviews } from '../../../browser/widget/chatMediaPreview.js';
import { previewKind } from '../../../browser/widget/chatTurnPills.js';

suite('ChatMediaPreview', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('renders playback actions for output paths and links, never for code fences or web URLs', () => {
		const element = document.createElement('div');
		const path = document.createElement('code');
		path.textContent = 'C:\\work\\My video\\preview.mp4';
		const link = document.createElement('a');
		link.setAttribute('data-href', 'file:///tmp/voice.wav');
		link.textContent = 'Listen';
		const fence = document.createElement('pre');
		const command = document.createElement('code');
		command.textContent = '/tmp/video.mp4';
		fence.append(command);
		const webLink = document.createElement('a');
		webLink.setAttribute('data-href', 'https://example.com/video.mp4');
		element.append(path, link, fence, webLink);
		const opened: string[] = [];
		store.add(renderChatMediaPreviews(element, { setupManagedHover: () => ({ dispose() { }, show() { }, hide() { }, update() { } }) }, uri => opened.push(uri.path)));
		const buttons = [...element.querySelectorAll<HTMLElement>('.chat-media-preview .monaco-button')];
		assert.deepStrictEqual({ count: buttons.length, opened, codeFences: element.querySelectorAll('pre code').length, webLinks: element.querySelectorAll('a[data-href^="https:"]').length }, { count: 2, opened: [], codeFences: 1, webLinks: 1 });
		buttons[1].click();
		assert.deepStrictEqual(opened, ['/tmp/voice.wav']);
	});

	test('recognizes complete local output paths with spaces and Unicode', () => {
		for (const path of ['C:\\work\\Тест видео\\preview.MP4', '/Users/test/My video/preview.webm', 'file:///C:/work/My%20video/preview.mp4']) {
			const resource = parseChatMediaResource(path);
			assert.ok(resource, path);
			assert.strictEqual(isChatMediaResource(resource), true);
			assert.strictEqual(previewKind(resource, true), 'media');
			assert.strictEqual(getEditorOverrideForChatResource(resource, new TestConfigurationService()), BrowserViewEditorId);
		}
	});

	test('does not turn commands, relative paths, network shares or web links into local players', () => {
		for (const value of ['ffmpeg -i source.mp4 output.mp4', 'output/preview.mp4', 'https://example.com/video.mp4', 'file://server/share/video.mp4', '//server/share/video.mp4', 'command:open?file=video.mp4', '/tmp/script.py']) {
			assert.strictEqual(parseChatMediaResource(value), undefined, value);
		}
		assert.strictEqual(previewKind(URI.file('/tmp/video.mp4'), false), undefined);
	});

	test('keeps explicit user editor associations and ordinary file handling', () => {
		const configuration = new TestConfigurationService({
			[ChatConfiguration.EditorAssociations]: { '*.mp4': 'custom.player' },
		});
		assert.strictEqual(getEditorOverrideForChatResource(URI.file('/tmp/video.mp4'), configuration), 'custom.player');
		assert.strictEqual(getEditorOverrideForChatResource(URI.file('/tmp/script.py'), configuration), undefined);
		assert.strictEqual(getEditorOverrideForChatResource(URI.parse('https://example.com/video.mp4'), configuration), 'custom.player');
		assert.strictEqual(getEditorOverrideForChatResource(URI.file('/tmp/audio.wav'), new TestConfigurationService()), BrowserViewEditorId);
	});
});

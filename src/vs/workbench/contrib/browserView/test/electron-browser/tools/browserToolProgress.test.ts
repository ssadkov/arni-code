/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IToolInvocation } from '../../../../chat/common/tools/languageModelToolsService.js';
import { BrowserToolProgress } from '../../../electron-browser/tools/browserToolProgress.js';

suite('Browser tool progress', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const invocation = (request = 'request-1', session = 'test'): IToolInvocation => ({
		callId: 'call-1', toolId: 'click_element', chatRequestId: request,
		context: { sessionResource: URI.parse('chat:' + session) }, parameters: {},
	});
	const summary = (ref = 'e33', noise = '') => `Page Title: Form\nURL: https://example.test/form\nRecent events: ${noise}\nSnapshot:\n- button "Start" [ref=${ref}]${noise ? ' [focused]' : ''}`;

	test('interleaved reads cannot reset unsuccessful clicks; new requests and pages are independent', () => {
		const guard = new BrowserToolProgress();
		for (let i = 0; i < 2; i++) {
			assert.strictEqual(guard.begin(invocation(), 'click', 'page', 1), undefined);
			assert.strictEqual(guard.read(invocation(), 'page', summary()), undefined);
		}
		assert.strictEqual(guard.begin(invocation(), 'click', 'page', 1)?.stopCurrentTurn, true);
		assert.strictEqual(guard.begin(invocation('new-request'), 'click', 'page', 1), undefined);
		assert.strictEqual(guard.begin(invocation('request-1', 'other-session'), 'click', 'page', 1), undefined);
		assert.strictEqual(guard.begin(invocation(), 'click', 'other-page', 1), undefined);
	});

	test('reference churn and console timestamps do not turn repeated reads into progress', () => {
		const guard = new BrowserToolProgress();
		assert.strictEqual(guard.read(invocation(), 'page', summary()), undefined);
		assert.strictEqual(guard.read(invocation(), 'page', summary('e99', '10:20:01')), undefined);
		assert.strictEqual(guard.read(invocation(), 'page', summary('e123', '10:20:02'))?.stopCurrentTurn, true);
		assert.strictEqual(guard.read(invocation(), 'page', summary().replace('/form', '/questions')), undefined);
	});

	test('verified changes reset attempts and unchanged reads, while another failed signature stays blocked', () => {
		const guard = new BrowserToolProgress();
		for (let i = 0; i < 2; i++) {
			guard.begin(invocation(), 'type', 'page', 1);
			guard.begin(invocation(), 'type', 'page', 2);
			guard.read(invocation(), 'page', summary());
		}
		guard.changed(invocation(), 'type', 'page', 1);
		assert.deepStrictEqual({
			changed: guard.begin(invocation(), 'type', 'page', 1),
			read: guard.read(invocation(), 'page', summary()),
			other: guard.begin(invocation(), 'type', 'page', 2)?.stopCurrentTurn,
			focusOnly: guard.samePage(summary(), summary('e42', 'log')),
			questions: guard.samePage(summary(), summary() + '\n- textbox "Email"'),
		}, { changed: undefined, read: undefined, other: true, focusOnly: true, questions: false });
	});
});

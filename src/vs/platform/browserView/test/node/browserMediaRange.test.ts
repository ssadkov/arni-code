/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { browserMediaRange } from '../../common/browserMediaRange.js';

suite('BrowserMediaRange', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('serves full media and the bounded, open-ended and suffix ranges used for metadata and seeking', () => {
		assert.deepStrictEqual([null, 'bytes=0-99', 'bytes=900-', 'bytes=-100', 'bytes=900-2000'].map(range => browserMediaRange(range, 1000)), [
			{ status: 200, headers: { 'Accept-Ranges': 'bytes', 'Content-Length': '1000' } },
			...[['0-99', '100'], ['900-999', '100'], ['900-999', '100'], ['900-999', '100']].map(([span, length]) => ({ status: 206, headers: { 'Accept-Ranges': 'bytes', 'Content-Length': length, 'Content-Range': `bytes ${span}/1000` } })),
		]);
	});

	test('rejects invalid or unsatisfiable ranges without returning partial bytes as a complete file', () => {
		for (const range of ['bytes=1000-', 'bytes=90-10', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bytes=9007199254740992-', 'bogus']) {
			assert.deepStrictEqual(browserMediaRange(range, 1000), { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Length': '0', 'Content-Range': 'bytes */1000' } }, range);
		}
		assert.strictEqual(browserMediaRange('bytes=0-', 0).status, 416);
	});
});

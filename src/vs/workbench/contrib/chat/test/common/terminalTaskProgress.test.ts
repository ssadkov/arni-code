/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { TerminalTaskProgress } from '../../common/terminalTaskProgress.js';

suite('TerminalTaskProgress', () => {
	test('unknown output and incidental percentages do not claim task completion', () => {
		const progress = new TerminalTaskProgress();
		progress.update('CPU 99%\nWaiting for input\n0/0 (0%)');
		assert.deepStrictEqual([progress.percent, progress.estimatedRemainingSeconds(60)], [undefined, undefined]);
	});
	test('split frame counters update from stdout and estimate remaining time', () => {
		const progress = new TerminalTaskProgress();
		progress.update('200/1000 (20');
		progress.update('%)\r400/1000 (40%)');
		assert.deepStrictEqual([progress.percent, progress.estimatedRemainingSeconds(40)], [40, 60]);
	});
	test('ffmpeg uses declared duration, clamps completion and does not invent an ETA at zero', () => {
		const progress = new TerminalTaskProgress();
		progress.update('Duration: 00:02:00.00\nframe= 1 time=00:00:00.00');
		assert.strictEqual(progress.estimatedRemainingSeconds(10), undefined);
		progress.update('\rframe= 100 time=00:01:00.00\n');
		assert.deepStrictEqual([progress.percent, progress.estimatedRemainingSeconds(20)], [50, 20]);
		progress.update('out_time=00:02:01.00\n');
		assert.strictEqual(progress.percent, 100);
	});
});

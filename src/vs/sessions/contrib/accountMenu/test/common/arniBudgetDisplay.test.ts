/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { arniBudgetAvailability, arniBudgetWindowShare, formatArniUsd, IArniBudget, IArniBudgetWindow } from '../../common/arniBudgetDisplay.js';

suite('Sessions - Arni budget display', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const window = (usedMicros: number, limitMicros: number, requests = 0, requestLimit = 150): IArniBudgetWindow => ({ usedMicros, limitMicros, requests, requestLimit, resetsAt: null });
	const budget = (balanceMicros: number, fiveHour: IArniBudgetWindow, weekly: IArniBudgetWindow): IArniBudget => ({ balanceMicros, enabled: true, expired: false, validUntil: '2026-12-01T00:00:00Z', fiveHour, weekly });

	test('shows the tightest limit and warns near it', () => {
		assert.deepStrictEqual([
			arniBudgetAvailability(budget(10_000_000, window(100_000, 2_000_000), window(1_000_000, 5_000_000))),
			arniBudgetAvailability(budget(10_000_000, window(1_700_000, 2_000_000), window(1_700_000, 5_000_000))),
			arniBudgetAvailability(budget(10_000_000, window(0, 2_000_000), window(4_500_000, 5_000_000))),
			arniBudgetAvailability(budget(1_000_000, window(0, 2_000_000), window(0, 5_000_000))),
			arniBudgetAvailability(budget(10_000_000, window(2_000_000, 2_000_000), window(0, 5_000_000))),
			arniBudgetAvailability(budget(10_000_000, window(0, 2_000_000, 150), window(0, 5_000_000))),
		], [
			{ availableMicros: 1_900_000, limit: 'fiveHour', level: 'ok' },
			{ availableMicros: 300_000, limit: 'fiveHour', level: 'warning' },
			{ availableMicros: 500_000, limit: 'weekly', level: 'warning' },
			{ availableMicros: 1_000_000, limit: 'balance', level: 'ok' },
			{ availableMicros: 0, limit: 'fiveHour', level: 'exhausted' },
			{ availableMicros: 0, limit: 'fiveHour', level: 'exhausted' },
		]);
	});

	test('tolerates a backend without windows and a negative balance', () => {
		assert.deepStrictEqual(arniBudgetAvailability({ balanceMicros: -5, enabled: true, expired: false, validUntil: '' }), { availableMicros: 0, limit: 'balance', level: 'exhausted' });
	});

	test('window share follows money or requests, whichever is larger', () => {
		assert.deepStrictEqual([arniBudgetWindowShare(window(1_000_000, 2_000_000, 30)), arniBudgetWindowShare(window(0, 2_000_000, 120)), arniBudgetWindowShare(window(3_000_000, 2_000_000)), formatArniUsd(420_000)], [0.5, 0.8, 1, '$0.42']);
	});
});

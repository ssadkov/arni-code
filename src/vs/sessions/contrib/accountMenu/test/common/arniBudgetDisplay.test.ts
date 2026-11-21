/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { activeArniDeepSeekBonus, arniBudgetAvailability, arniBudgetTotalMicros, arniBudgetWindowLimits, arniBudgetWindowRemainingMicros, arniBudgetWindowShare, formatArniMoney, IArniBudget, IArniBudgetWindow } from '../../common/arniBudgetDisplay.js';

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

	test('the whole balance is shown even when a rate window caps what is available now', () => {
		const capped = budget(15_000_000, window(0, 2_000_000), window(0, 5_000_000));
		assert.deepStrictEqual([
			{ total: arniBudgetTotalMicros(capped), available: arniBudgetAvailability(capped).availableMicros },
			arniBudgetTotalMicros({ ...capped, enabled: false }),
			arniBudgetTotalMicros({ ...capped, expired: true }),
			arniBudgetTotalMicros({ ...capped, balanceMicros: -5 }),
		], [
			{ total: 15_000_000, available: 2_000_000 },
			0,
			0,
			0,
		]);
	});

	test('shows a live DeepSeek bonus independently of the main balance and its validity', () => {
		const now = Date.parse('2026-12-14T18:00:00Z');
		const main = budget(1_000_000, window(0, 2_000_000), window(0, 5_000_000));
		const bonus = {
			balanceMicros: 12_400_000, grantedMicros: 15_000_000, expiresAt: '2026-12-14T18:59:59Z', expired: false,
			fiveHour: { remainingMicros: 5_000_000 }, weekly: { remainingMicros: 7_400_000 },
		};
		assert.strictEqual(activeArniDeepSeekBonus({ ...main, expired: true, bonus }, now), bonus);
		assert.strictEqual(arniBudgetTotalMicros({ ...main, bonus }), 1_000_000);
		for (const unavailable of [
			undefined, main, { ...main, bonus: null }, { ...main, bonus, enabled: false },
			{ ...main, bonus: { ...bonus, balanceMicros: 0 } }, { ...main, bonus: { ...bonus, expired: true } },
			{ ...main, bonus: { ...bonus, expiresAt: new Date(now).toISOString() } },
		]) {
			assert.strictEqual(activeArniDeepSeekBonus(unavailable, now), undefined);
		}
	});

	test('a window limits spending only when it is tighter than the balance', () => {
		// $2.90 left under $10 windows: the windows are only ceilings that cannot bind yet.
		const ceiling = budget(2_900_000, window(0, 10_000_000), window(760_000, 10_000_000));
		const binding = budget(15_000_000, window(0, 2_000_000), window(500_000, 5_000_000));
		const requestsUsedUp = budget(15_000_000, window(0, 2_000_000, 150), window(0, 5_000_000));
		assert.deepStrictEqual([
			[arniBudgetWindowLimits(ceiling, ceiling.fiveHour!), arniBudgetWindowLimits(ceiling, ceiling.weekly!)],
			[arniBudgetWindowLimits(binding, binding.fiveHour!), arniBudgetWindowLimits(binding, binding.weekly!)],
			arniBudgetWindowLimits(requestsUsedUp, requestsUsedUp.fiveHour!),
			[arniBudgetWindowRemainingMicros(binding.fiveHour!), arniBudgetWindowRemainingMicros(binding.weekly!), arniBudgetWindowRemainingMicros(requestsUsedUp.fiveHour!)],
		], [
			[false, false],
			[true, true],
			true,
			[2_000_000, 4_500_000, 0],
		]);
	});

	test('window share follows money or requests, whichever is larger', () => {
		assert.deepStrictEqual([arniBudgetWindowShare(window(1_000_000, 2_000_000, 30)), arniBudgetWindowShare(window(0, 2_000_000, 120)), arniBudgetWindowShare(window(3_000_000, 2_000_000))], [0.5, 0.8, 1]);
	});

	test('formats converted amounts, USD fallback and zero-cost chat', () => {
		const rates = { RUB: 100, KZT: 500 };
		assert.deepStrictEqual([
			formatArniMoney(420_000, undefined, rates),
			formatArniMoney(420_000, 'KZT', rates),
			formatArniMoney(420_000, 'USD', rates),
			formatArniMoney(420_000, 'RUB', undefined),
			formatArniMoney(0, 'RUB', undefined),
		].map(value => value.replace(/\s/g, ' ')), ['≈ 42,00 ₽', '≈ 210,00 ₸', '$0.42', '$0.42', '0,00 ₽']);
	});

	test('rounds rubles and tenge to the kopeck even when finer digits are asked for', () => {
		const rates = { RUB: 100, KZT: 500 };
		assert.deepStrictEqual([
			formatArniMoney(123_456, 'RUB', rates, 6),
			formatArniMoney(123_456, 'KZT', rates, 6),
			formatArniMoney(40, 'RUB', rates, 6),
			formatArniMoney(123_456, 'USD', rates, 6),
		].map(value => value.replace(/\s/g, ' ')), ['≈ 12,35 ₽', '≈ 61,73 ₸', '< 0,01 ₽', '$0.123456']);
	});
});

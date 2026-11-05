/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IArniBudgetWindow {
	readonly usedMicros: number;
	readonly limitMicros: number;
	readonly requests: number;
	readonly requestLimit: number;
	readonly resetsAt: string | null;
}

export interface IArniBudget {
	readonly balanceMicros: number;
	readonly enabled: boolean;
	readonly expired: boolean;
	readonly validUntil: string;
	/** Absent when an older backend answers. */
	readonly fiveHour?: IArniBudgetWindow;
	readonly weekly?: IArniBudgetWindow;
}

export type ArniBudgetLimit = 'balance' | 'fiveHour' | 'weekly';

export interface IArniBudgetAvailability {
	readonly availableMicros: number;
	/** What stops spending first. */
	readonly limit: ArniBudgetLimit;
	readonly level: 'ok' | 'warning' | 'exhausted';
}

const WARNING_SHARE = 0.8;

function windowRemaining(window: IArniBudgetWindow): number {
	return window.requests >= window.requestLimit ? 0 : Math.max(0, window.limitMicros - window.usedMicros);
}

function isWindowNearLimit(window: IArniBudgetWindow): boolean {
	return window.usedMicros >= window.limitMicros * WARNING_SHARE || window.requests >= window.requestLimit * WARNING_SHARE;
}

/** What can be spent right now: the smallest of the balance and both rate windows. */
export function arniBudgetAvailability(budget: IArniBudget): IArniBudgetAvailability {
	let availableMicros = Math.max(0, budget.balanceMicros);
	let limit: ArniBudgetLimit = 'balance';
	for (const [name, window] of [['fiveHour', budget.fiveHour], ['weekly', budget.weekly]] as const) {
		if (window && windowRemaining(window) < availableMicros) {
			availableMicros = windowRemaining(window);
			limit = name;
		}
	}
	const nearLimit = [budget.fiveHour, budget.weekly].some(window => window && isWindowNearLimit(window));
	return { availableMicros, limit, level: availableMicros <= 0 ? 'exhausted' : nearLimit ? 'warning' : 'ok' };
}

/** Share of the window's money or requests already used, whichever is larger, from 0 to 1. */
export function arniBudgetWindowShare(window: IArniBudgetWindow): number {
	const money = window.limitMicros > 0 ? window.usedMicros / window.limitMicros : 1;
	const requests = window.requestLimit > 0 ? window.requests / window.requestLimit : 1;
	return Math.min(1, Math.max(0, money, requests));
}

export type ArniBillingRates = Partial<Record<'RUB' | 'KZT', number | null>>;

export function formatArniMoney(micros: number, preferred: string | undefined, rates: ArniBillingRates | undefined, fractionDigits = 2): string {
	const localCurrency = preferred === 'KZT' ? 'KZT' : preferred === 'USD' ? undefined : 'RUB';
	const rate = localCurrency ? rates?.[localCurrency] : undefined;
	const converted = typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
	const currency = (converted || micros === 0) && localCurrency ? localCurrency : 'USD';
	const locale = { USD: 'en-US', RUB: 'ru-RU', KZT: 'ru-KZ' }[currency];
	const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: fractionDigits })
		.format(micros / 1_000_000 * (converted ? rate : 1));
	return converted && micros !== 0 ? '≈ ' + formatted : formatted;
}

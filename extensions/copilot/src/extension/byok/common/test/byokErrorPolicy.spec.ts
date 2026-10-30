/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseArniBudgetError } from '../byokErrorPolicy';

describe('parseArniBudgetError', () => {
	it('recognizes budget refusals behind the transport prefix', () => {
		expect([
			parseArniBudgetError('Rate limit exceeded\n\n{"code":"five_hour_limit","message":"Недостаточно лимита","resetsAt":"2026-10-30T01:13:12.185Z"}'),
			parseArniBudgetError('400 Rate limit exceeded\n{"error":{"code":"weekly_limit"}}'),
			parseArniBudgetError('Request Failed: 403 {"error":{"code":"insufficient_budget","resetsAt":"not a date"}}'),
		]).toEqual([
			{ code: 'five_hour_limit', resetsAt: new Date('2026-10-30T01:13:12.185Z') },
			{ code: 'weekly_limit', resetsAt: undefined },
			{ code: 'insufficient_budget', resetsAt: undefined },
		]);
	});

	it('leaves other errors alone', () => {
		expect([
			parseArniBudgetError('Rate limit exceeded'),
			parseArniBudgetError('Rate limit exceeded\n{"code":"upstream_provider_rate_limit"}'),
			parseArniBudgetError('broken {json'),
		]).toEqual([undefined, undefined, undefined]);
	});
});

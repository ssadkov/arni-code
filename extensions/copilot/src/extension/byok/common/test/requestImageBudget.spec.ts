/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { IEndpointBody } from '../../../../platform/networking/common/networking';
import { fitImagesToRequestBudget, OMITTED_IMAGE_TEXT } from '../requestImageBudget';

function image(name: string, size: number) {
	return { type: 'image_url', image_url: { url: `data:image/png;base64,${name}${'A'.repeat(size)}` } };
}

function summarize(body: IEndpointBody) {
	return body.messages!.map(message => Array.isArray(message.content)
		? message.content.map((part: { type: string; text?: string; image_url?: { url: string } }) => part.type === 'image_url' ? part.image_url!.url.slice(22, 25) : part.text)
		: message.content);
}

describe('fitImagesToRequestBudget', () => {
	it('drops the oldest images until the body fits and keeps the newest', () => {
		const body: IEndpointBody = {
			messages: [
				{ role: 'user', content: [{ type: 'text', text: 'draw' }, image('one', 2_000)] },
				{ role: 'tool', tool_call_id: 'a', content: 'saved' },
				{ role: 'user', content: [image('two', 2_000)] },
				{ role: 'user', content: [image('thr', 2_000)] },
			],
		};
		const removed = fitImagesToRequestBudget(body, 3_000);
		expect({ removed, messages: summarize(body), size: JSON.stringify(body).length <= 3_000 }).toEqual({
			removed: 2,
			messages: [['draw', OMITTED_IMAGE_TEXT], 'saved', [OMITTED_IMAGE_TEXT], ['thr']],
			size: true,
		});
	});

	it('leaves a body that already fits untouched', () => {
		const body: IEndpointBody = { messages: [{ role: 'user', content: [image('one', 100)] }] };
		const before = JSON.stringify(body);
		expect([fitImagesToRequestBudget(body, 10_000), JSON.stringify(body) === before]).toEqual([0, true]);
	});

	it('removes even the newest image when it alone is too large', () => {
		const body: IEndpointBody = { messages: [{ role: 'user', content: [image('one', 5_000)] }] };
		expect([fitImagesToRequestBudget(body, 1_000), summarize(body)]).toEqual([1, [[OMITTED_IMAGE_TEXT]]]);
	});
});

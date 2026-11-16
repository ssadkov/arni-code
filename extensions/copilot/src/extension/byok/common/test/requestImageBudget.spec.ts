/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { IEndpointBody } from '../../../../platform/networking/common/networking';
import { fitImagesToRequestBudget, IRequestImageBudget, OMITTED_IMAGE_TEXT } from '../requestImageBudget';

function bodyLimit(maxBodyBytes: number): IRequestImageBudget {
	return { maxBodyBytes, maxImageBytes: Number.MAX_SAFE_INTEGER, maxImages: Number.MAX_SAFE_INTEGER };
}

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
		const removed = fitImagesToRequestBudget(body, bodyLimit(3_000));
		expect({ removed, messages: summarize(body), size: JSON.stringify(body).length <= 3_000 }).toEqual({
			removed: 2,
			messages: [['draw', OMITTED_IMAGE_TEXT], 'saved', [OMITTED_IMAGE_TEXT], ['thr']],
			size: true,
		});
	});

	it('leaves a body that already fits untouched', () => {
		const body: IEndpointBody = { messages: [{ role: 'user', content: [image('one', 100)] }] };
		const before = JSON.stringify(body);
		expect([fitImagesToRequestBudget(body, bodyLimit(10_000)), JSON.stringify(body) === before]).toEqual([0, true]);
	});

	it('removes even the newest image when it alone is too large', () => {
		const body: IEndpointBody = { messages: [{ role: 'user', content: [image('one', 5_000)] }] };
		expect([fitImagesToRequestBudget(body, bodyLimit(1_000)), summarize(body)]).toEqual([1, [[OMITTED_IMAGE_TEXT]]]);
	});

	it('drops the oldest images when their total size or count is over the limit, even if the body fits', () => {
		const bySize: IEndpointBody = { messages: [{ role: 'user', content: [image('one', 4_000), image('two', 4_000), image('thr', 4_000)] }] };
		const byCount: IEndpointBody = { messages: [{ role: 'user', content: [image('one', 10), image('two', 10), image('thr', 10)] }] };
		expect([
			fitImagesToRequestBudget(bySize, { maxBodyBytes: 100_000, maxImageBytes: 7_000, maxImages: 20 }), summarize(bySize),
			fitImagesToRequestBudget(byCount, { maxBodyBytes: 100_000, maxImageBytes: 100_000, maxImages: 1 }), summarize(byCount),
		]).toEqual([1, [[OMITTED_IMAGE_TEXT, 'two', 'thr']], 2, [[OMITTED_IMAGE_TEXT, OMITTED_IMAGE_TEXT, 'thr']]]);
	});
});

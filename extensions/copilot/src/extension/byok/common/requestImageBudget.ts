/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IEndpointBody } from '../../../platform/networking/common/networking';

/**
 * The Arni API runs on Vercel, which rejects request bodies above 4.5 MB with
 * `413 FUNCTION_PAYLOAD_TOO_LARGE`. Leave room for headers and rounding.
 */
export const ARNI_PROXY_MAX_BODY_BYTES = 4_000_000;

/** Text the model sees in place of an image dropped from the history. */
export const OMITTED_IMAGE_TEXT = '[An image from earlier in this chat was removed so the request fits the size limit. View the file again if you need it.]';

interface IImagePart {
	type: 'image_url';
	image_url?: { url?: unknown };
}

const encoder = new TextEncoder();

function byteLength(value: unknown): number {
	return encoder.encode(JSON.stringify(value)).byteLength;
}

/**
 * Replaces Chat Completions image parts with {@link OMITTED_IMAGE_TEXT}, oldest first,
 * until the serialized body fits {@link maxBytes}. Every image is resent with every turn,
 * so a couple of full-size pictures in the history would otherwise fail each later request.
 * @returns How many images were removed.
 */
export function fitImagesToRequestBudget(body: IEndpointBody, maxBytes: number): number {
	const images: { content: unknown[]; index: number }[] = [];
	for (const message of body.messages ?? []) {
		const content: unknown = message?.content;
		if (!Array.isArray(content)) {
			continue;
		}
		content.forEach((part, index) => {
			if ((part as IImagePart | undefined)?.type === 'image_url') {
				images.push({ content, index });
			}
		});
	}
	if (!images.length) {
		return 0;
	}

	const placeholder = { type: 'text', text: OMITTED_IMAGE_TEXT };
	const placeholderBytes = byteLength(placeholder);
	let total = byteLength(body);
	let removed = 0;
	for (const { content, index } of images) {
		if (total <= maxBytes) {
			break;
		}
		total -= byteLength(content[index]) - placeholderBytes;
		content[index] = { ...placeholder };
		removed++;
	}
	return removed;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IEndpointBody } from '../../../platform/networking/common/networking';

/** Request limits that a proxy enforces on images in a Chat Completions body. */
export interface IRequestImageBudget {
	/** Serialized JSON body size, in bytes. */
	readonly maxBodyBytes: number;
	/** Decoded size of all embedded images together, in bytes. */
	readonly maxImageBytes: number;
	/** Number of images in one request. */
	readonly maxImages: number;
}

/**
 * The Arni API (`/api/chat/completions`) rejects a body above 3.8 MB with 413, and
 * images above 2.5 MB in total or more than 20 with 400 `images_too_large`.
 * Stay a little under each, so rounding and headers never tip a request over.
 */
export const ARNI_PROXY_IMAGE_BUDGET: IRequestImageBudget = {
	maxBodyBytes: 3_600_000,
	maxImageBytes: 2_400_000,
	maxImages: 20,
};

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

/** Decoded size of a `data:` URL image; other URLs carry no bytes in the body. */
function decodedImageBytes(part: IImagePart): number {
	const url = part.image_url?.url;
	if (typeof url !== 'string' || !url.startsWith('data:')) {
		return 0;
	}
	const data = url.slice(url.indexOf(',') + 1);
	const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
	return Math.floor(data.length * 3 / 4) - padding;
}

/**
 * Replaces Chat Completions image parts with {@link OMITTED_IMAGE_TEXT}, oldest first,
 * until the body fits every limit in {@link budget}. Every image is resent with every turn,
 * so a few pictures in the history would otherwise fail each later request.
 * @returns How many images were removed.
 */
export function fitImagesToRequestBudget(body: IEndpointBody, budget: IRequestImageBudget): number {
	const images: { content: unknown[]; index: number; part: IImagePart }[] = [];
	for (const message of body.messages ?? []) {
		const content: unknown = message?.content;
		if (!Array.isArray(content)) {
			continue;
		}
		content.forEach((part, index) => {
			if ((part as IImagePart | undefined)?.type === 'image_url') {
				images.push({ content, index, part: part as IImagePart });
			}
		});
	}
	if (!images.length) {
		return 0;
	}

	const placeholder = { type: 'text', text: OMITTED_IMAGE_TEXT };
	const placeholderBytes = byteLength(placeholder);
	let bodyBytes = byteLength(body);
	let imageBytes = images.reduce((sum, image) => sum + decodedImageBytes(image.part), 0);
	let count = images.length;
	let removed = 0;
	for (const { content, index, part } of images) {
		if (bodyBytes <= budget.maxBodyBytes && imageBytes <= budget.maxImageBytes && count <= budget.maxImages) {
			break;
		}
		bodyBytes -= byteLength(part) - placeholderBytes;
		imageBytes -= decodedImageBytes(part);
		count--;
		content[index] = { ...placeholder };
		removed++;
	}
	return removed;
}

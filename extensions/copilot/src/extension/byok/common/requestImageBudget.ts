/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IEndpointBody } from '../../../platform/networking/common/networking';

/** The Arni backend rejects request bodies above this size before parsing JSON. */
const ARNI_MAX_BODY_BYTES = 3_800_000;
const ARNI_MAX_IMAGES = 6;
const ARNI_MAX_IMAGE_BYTES = 2_500_000;

/** Text the model sees in place of an image dropped from the history. */
export const OMITTED_IMAGE_TEXT = '[Старый скриншот удалён из истории, чтобы уложиться в лимит. Сделайте новый, если он нужен.]';

interface IImagePart {
	type: 'image_url';
	image_url?: { url?: string };
}

const encoder = new TextEncoder();

/** Returns the number of UTF-8 bytes the value occupies in the request JSON. */
function byteLength(value: object): number {
	return encoder.encode(JSON.stringify(value)).byteLength;
}

/**
 * Estimates the decoded size without allocating a buffer for the screenshot.
 * Matches the backend's estimate, including base64 padding.
 */
function imageBytes(url: string | undefined): number {
	const comma = url?.startsWith('data:') ? url.indexOf(',') : -1;
	return url && comma >= 0 ? Math.floor((url.length - comma - 1) * 3 / 4) : 0;
}

/**
 * Keeps the newest Chat Completions images that fit the Arni image and body limits.
 * Replaces the others in the serialized request body with {@link OMITTED_IMAGE_TEXT}.
 * @returns How many images were removed.
 */
export function fitImagesToRequestBudget(body: IEndpointBody, maxBytes = ARNI_MAX_BODY_BYTES): number {
	const placeholder = { type: 'text', text: OMITTED_IMAGE_TEXT };
	const images: { content: unknown[]; index: number; part: IImagePart }[] = [];
	for (const message of body.messages ?? []) {
		const content: unknown = message?.content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (let index = 0; index < content.length; index++) {
			const part = content[index] as IImagePart | undefined;
			if (part?.type === 'image_url') {
				images.push({ content, index, part });
				content[index] = placeholder;
			}
		}
	}
	if (!images.length) {
		return 0;
	}

	// Measure the text, tools and placeholder bytes once, before restoring images.
	const placeholderBytes = byteLength(placeholder);
	let bodyBytes = byteLength(body);
	let totalImageBytes = 0;
	let kept = 0;
	for (let i = images.length - 1; i >= 0 && kept < ARNI_MAX_IMAGES; i--) {
		const { content, index, part } = images[i];
		const size = imageBytes(part.image_url?.url);
		if (totalImageBytes + size > ARNI_MAX_IMAGE_BYTES) {
			continue;
		}
		const extraBodyBytes = byteLength(part) - placeholderBytes;
		if (bodyBytes + extraBodyBytes > maxBytes) {
			continue;
		}
		content[index] = part;
		bodyBytes += extraBodyBytes;
		totalImageBytes += size;
		kept++;
	}
	return images.length - kept;
}

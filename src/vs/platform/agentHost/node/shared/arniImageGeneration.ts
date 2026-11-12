/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { streamToBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ARNI_API_ORIGINS } from '../../common/arniApi.js';
import { IRequestService } from '../../../request/common/request.js';
import { imageModels, type IGeneratedImage, type IImageRequest, type IImageServerToolAccessor } from './imageServerTools.js';

const GENERATE_TIMEOUT_MS = 240_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_IMAGE_BYTES = 3_000_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A user-facing image error. Only network failures and HTTP 503 are worth trying on the other origin. */
class ImageApiError extends Error {
	constructor(message: string, readonly retryable = false) {
		super(message);
	}
}

/**
 * Calls the shared Arni API, which holds the Bedrock image key and charges the
 * user's budget. The user token is the Arni session JWT.
 */
export function createArniImageAccessor(requestService: IRequestService, readUserToken: () => string | undefined): IImageServerToolAccessor {
	return {
		isEnabled(): boolean {
			return true;
		},
		async generate(request: IImageRequest, requestKey: string): Promise<IGeneratedImage> {
			const token = readUserToken()?.trim();
			if (!token) {
				throw new Error('Image generation requires an Arni sign-in.');
			}
			let lastError: Error | undefined;
			// The idempotency key makes a retry on the other origin return the same paid image.
			for (const origin of ARNI_API_ORIGINS) {
				try {
					return await generateAtOrigin(requestService, origin, token, request, requestKey);
				} catch (error) {
					if (!(error instanceof ImageApiError) || !error.retryable) {
						throw error;
					}
					lastError = error;
				}
			}
			throw lastError ?? new Error('Image generation failed.');
		},
	};
}

async function generateAtOrigin(requestService: IRequestService, origin: string, token: string, request: IImageRequest, requestKey: string): Promise<IGeneratedImage> {
	let body: string;
	let status: number | undefined;
	try {
		const created = await requestService.request({
			type: 'POST',
			url: `${origin}/api/images/generations`,
			timeout: GENERATE_TIMEOUT_MS,
			followRedirects: 0,
			callSite: 'agentHost.generateImage',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`,
				'Idempotency-Key': requestKey,
			},
			data: JSON.stringify({ prompt: request.prompt, model: imageModels[request.kind].id, aspect_ratio: request.aspectRatio, n: 1 }),
		}, CancellationToken.None);
		status = created.res.statusCode;
		body = (await streamToBuffer(created.stream)).toString();
	} catch {
		// Transport errors can contain request headers. Never forward them to a model or log.
		throw new ImageApiError('Image generation is unavailable. Check the internet connection and try again.', true);
	}
	if (status === 401) {
		throw new ImageApiError('Image generation is not authorized. Sign in to Arni again.');
	}
	const parsed = parseGenerationResponse(body);
	if (status === undefined || status < 200 || status >= 300 || !parsed.id) {
		// The API's own message explains budget, language and filter refusals in Russian for the user.
		throw new ImageApiError(parsed.message ? `Image generation failed: ${parsed.message}` : `Image generation failed (HTTP ${status ?? 'unknown'}).`, status === 503);
	}
	const downloadFailed = 'The image was generated but could not be downloaded. Calling the tool again with the same arguments downloads it without a second charge.';
	let bytes: Uint8Array;
	try {
		const downloaded = await requestService.request({
			type: 'GET',
			url: `${origin}/api/images/${parsed.id}`,
			timeout: DOWNLOAD_TIMEOUT_MS,
			followRedirects: 0,
			callSite: 'agentHost.downloadImage',
			headers: { 'Authorization': `Bearer ${token}` },
		}, CancellationToken.None);
		if (downloaded.res.statusCode !== 200) {
			throw new ImageApiError(downloadFailed);
		}
		bytes = (await streamToBuffer(downloaded.stream)).buffer;
	} catch {
		throw new ImageApiError(downloadFailed);
	}
	if (!isPng(bytes)) {
		throw new ImageApiError('The API returned an invalid PNG.');
	}
	return { bytes, costMicros: parsed.costMicros };
}

/** Reads the generation id, cost and the API's error message; tolerates a non-JSON body. */
export function parseGenerationResponse(body: string): { id?: string; costMicros: number | null; message?: string } {
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch {
		return { costMicros: null };
	}
	const record = (value && typeof value === 'object' ? value : {}) as { id?: unknown; costMicros?: unknown; error?: unknown };
	const error = record.error as { message?: unknown } | string | undefined;
	const message = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : undefined;
	return {
		id: typeof record.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(record.id) ? record.id : undefined,
		costMicros: typeof record.costMicros === 'number' && Number.isFinite(record.costMicros) ? record.costMicros : null,
		message,
	};
}

export function isPng(bytes: Uint8Array): boolean {
	return bytes.length >= 24 && bytes.length <= MAX_IMAGE_BYTES && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

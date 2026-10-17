/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** HTTP metadata for the single byte ranges requested by Chromium's local media player. */
export function browserMediaRange(range: string | null, size: number): { status: number; headers: Record<string, string> } {
	const headers: Record<string, string> = { 'Accept-Ranges': 'bytes', 'Content-Length': String(size) };
	if (!range) {
		return { status: 200, headers };
	}
	const match = /^bytes=(\d*)-(\d*)$/.exec(range);
	const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
	const end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
		|| start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) === 0)) {
		return { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Length': '0', 'Content-Range': `bytes */${size}` } };
	}
	return { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';

let cachedOemCodePage: number | undefined;

/** Code page a new cmd.exe uses to read a batch file. On Russian Windows this is 866, not UTF-8. */
export function windowsOemCodePage(): number {
	if (cachedOemCodePage !== undefined) {
		return cachedOemCodePage;
	}
	if (process.platform !== 'win32') {
		cachedOemCodePage = 65001;
		return cachedOemCodePage;
	}
	try {
		const output = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'chcp'], {
			encoding: 'utf8',
			windowsHide: true,
		});
		const match = /(\d+)/.exec(output);
		cachedOemCodePage = match ? Number(match[1]) : 866;
	} catch {
		cachedOemCodePage = 866;
	}
	return cachedOemCodePage;
}

/** Bytes cmd.exe will decode back to `text` when the console code page is `codePage`. */
export function encodeCmdScript(text: string, codePage: number = windowsOemCodePage()): Buffer {
	if (codePage === 65001) {
		return Buffer.from(text, 'utf8');
	}
	const encode = codePage === 1251 ? to1251 : to866;
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) {
		bytes[i] = encode(text.charCodeAt(i));
	}
	return Buffer.from(bytes);
}

function to866(code: number): number {
	if (code < 0x80) {
		return code;
	}
	if (code >= 0x0410 && code <= 0x042F) {
		return code - 0x0410 + 0x80;
	}
	if (code >= 0x0430 && code <= 0x043F) {
		return code - 0x0430 + 0xA0;
	}
	if (code >= 0x0440 && code <= 0x044F) {
		return code - 0x0440 + 0xE0;
	}
	if (code === 0x0401) {
		return 0xF0;
	}
	if (code === 0x0451) {
		return 0xF1;
	}
	return 0x3F;
}

function to1251(code: number): number {
	if (code < 0x80) {
		return code;
	}
	if (code >= 0x0410 && code <= 0x044F) {
		return code - 0x0410 + 0xC0;
	}
	if (code === 0x0401) {
		return 0xA8;
	}
	if (code === 0x0451) {
		return 0xB8;
	}
	return 0x3F;
}

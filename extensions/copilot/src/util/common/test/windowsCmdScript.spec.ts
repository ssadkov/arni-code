/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { encodeCmdScript } from '../windowsCmdScript';

describe('encodeCmdScript', () => {
	const path = 'c:\\Assist\\1. Работа\\Урок12\\Урок 12-registration.html';

	it('keeps a Cyrillic path when cmd reads the file as CP866', () => {
		const bytes = encodeCmdScript(`@echo off\r\n"${path}"\r\n`, 866);
		const utf8Misread = Buffer.from(`@echo off\r\n"${path}"\r\n`, 'utf8');
		expect(bytes.includes(0x90)).toBe(true);
		expect(decode866(bytes)).toContain('Работа');
		expect(decode866(bytes)).toContain('Урок 12-registration.html');
		expect(decode866(utf8Misread)).toContain('╨а╨░╨▒╨╛╤В╨░');
		expect(decode866(utf8Misread)).not.toContain('Работа');
	});
});

function decode866(bytes: Uint8Array): string {
	let text = '';
	for (const byte of bytes) {
		text += String.fromCharCode(from866(byte));
	}
	return text;
}

function from866(byte: number): number {
	if (byte < 0x80) {
		return byte;
	}
	if (byte >= 0x80 && byte <= 0x9F) {
		return 0x0410 + (byte - 0x80);
	}
	if (byte >= 0xA0 && byte <= 0xAF) {
		return 0x0430 + (byte - 0xA0);
	}
	if (byte >= 0xE0 && byte <= 0xEF) {
		return 0x0440 + (byte - 0xE0);
	}
	if (byte === 0xF0) {
		return 0x0401;
	}
	if (byte === 0xF1) {
		return 0x0451;
	}
	return byte;
}

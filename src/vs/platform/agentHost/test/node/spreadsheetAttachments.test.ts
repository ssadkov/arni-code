/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IFileService } from '../../../files/common/files.js';
import { MessageAttachmentKind } from '../../common/state/protocol/state.js';
import { prepareSpreadsheetAttachment, spreadsheetAttachmentsFromPrompt } from '../../node/copilot/spreadsheetAttachments.js';

suite('Spreadsheet attachments', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const directory = URI.file('/sessions/chat-1');
	const bytes = VSBuffer.wrap(Uint8Array.from([80, 75, 3, 4, 255, 0, 128]));
	function files() {
		const writes: Array<{ path: string; bytes: number[] }> = [];
		const service: Pick<IFileService, 'readFile' | 'writeFile'> = {
			readFile: async () => ({ value: bytes }) as Awaited<ReturnType<IFileService['readFile']>>,
			writeFile: async (resource, content) => {
				assert.ok(content instanceof VSBuffer);
				writes.push({ path: resource.path, bytes: Array.from(content.buffer) });
				return { resource } as Awaited<ReturnType<IFileService['writeFile']>>;
			},
		};
		return { service, writes };
	}

	test('resource and embedded XLSX preserve bytes and produce the same stable local reference', async () => {
		const { service, writes } = files();
		const name = 'Продажи за октябрь.xlsx';
		const resource = await prepareSpreadsheetAttachment({ type: MessageAttachmentKind.Resource, uri: URI.file(`/Desktop/${name}`).toString(), label: name }, directory, service);
		const embedded = await prepareSpreadsheetAttachment({ type: MessageAttachmentKind.EmbeddedResource, label: name, contentType: 'application/octet-stream', data: encodeBase64(bytes) }, directory, service);
		assert.deepStrictEqual(embedded, resource);
		assert.deepStrictEqual(writes[0], writes[1]);
		assert.deepStrictEqual(writes[0].bytes, Array.from(bytes.buffer));
		assert.match(writes[0].path, /^\/sessions\/chat-1\/spreadsheet-attachments\/[a-f0-9]{64}\.xlsx$/);
		assert.ok(resource);
		const text = resource.reference;
		assert.ok(text.includes(JSON.stringify(name)) && text.includes('tables.py prepare') && text.includes('read-only'));
		assert.deepStrictEqual(spreadsheetAttachmentsFromPrompt(text), [{ type: MessageAttachmentKind.Resource, uri: URI.file(writes[0].path).toString(), label: name }]);
	});

	test('untrusted labels cannot choose the storage path', async () => {
		const { service, writes } = files();
		await prepareSpreadsheetAttachment({ type: MessageAttachmentKind.EmbeddedResource, label: '../../outside.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: encodeBase64(bytes) }, directory, service);
		assert.match(writes[0].path, /^\/sessions\/chat-1\/spreadsheet-attachments\/[a-f0-9]{64}\.xlsx$/);
	});

	test('ignores malformed transcript markers and unrelated paths', () => {
		assert.deepStrictEqual(spreadsheetAttachmentsFromPrompt([
			'<arni_spreadsheet_reference>invalid</arni_spreadsheet_reference>',
			'<arni_spreadsheet_reference>{"name":"book.xlsx","path":"/other/file.xlsx"}</arni_spreadsheet_reference>',
		].join('\n')), []);
	});

	test('leaves images, text and directories to the existing attachment handling', async () => {
		const { service, writes } = files();
		const results = await Promise.all([
			prepareSpreadsheetAttachment({ type: MessageAttachmentKind.EmbeddedResource, label: 'frame.png', contentType: 'image/png', data: encodeBase64(bytes) }, directory, service),
			prepareSpreadsheetAttachment({ type: MessageAttachmentKind.Resource, uri: 'file:///project/note.txt', label: 'note.txt' }, directory, service),
			prepareSpreadsheetAttachment({ type: MessageAttachmentKind.Resource, uri: 'file:///project/folder.xlsx', label: 'folder.xlsx', displayKind: 'directory' }, directory, service),
		]);
		assert.deepStrictEqual({ results, writes }, { results: [undefined, undefined, undefined], writes: [] });
	});

	test('rejects malformed and oversized embedded workbooks before saving', async () => {
		const { service, writes } = files();
		for (const data of ['not base64!', 'A'.repeat(45 * 1024 * 1024)]) {
			await assert.rejects(prepareSpreadsheetAttachment({ type: MessageAttachmentKind.EmbeddedResource, label: 'book.xlsx', contentType: 'application/octet-stream', data }, directory, service), /invalid or exceeds/);
		}
		assert.deepStrictEqual(writes, []);
	});

	test('surfaces read failures instead of silently losing an attachment', async () => {
		const { service } = files();
		service.readFile = async () => { throw new Error('access denied'); };
		await assert.rejects(prepareSpreadsheetAttachment({ type: MessageAttachmentKind.Resource, uri: 'file:///Desktop/book.xlsx', label: 'book.xlsx' }, directory, service), /access denied/);
	});
});

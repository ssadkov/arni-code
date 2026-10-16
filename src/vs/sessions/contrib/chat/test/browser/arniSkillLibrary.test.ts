/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { ArniSkillLibraryService } from '../../browser/arniSkillLibraryService.js';
import { arniLibraryHash, IArniSkillLibrary, parseArniSkillLibrary } from '../../common/arniSkillLibrary.js';

suite('Arni skill library', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	async function library(text = 'A useful skill', path = 'skills/media-toolkit/SKILL.md'): Promise<IArniSkillLibrary> {
		const files = [{ path, text, sha256: await arniLibraryHash(text) }];
		return { schemaVersion: 1, revision: await arniLibraryHash(JSON.stringify(files.map(file => [file.path, file.sha256]))), files };
	}

	test('rejects traversal, aliases, oversized or tampered code before installation', async () => {
		const valid = await library();
		assert.deepStrictEqual(await parseArniSkillLibrary(JSON.stringify(valid)), valid);
		for (const path of ['../outside.py', 'skills/../outside.py', 'skills/demo/scripts/NUL.py', 'skills/demo/scripts/x.exe', 'skills/demo/../SKILL.md', 'skills/demo/scripts/x%2f.py']) {
			await assert.rejects(parseArniSkillLibrary(JSON.stringify(await library('text', path))));
		}
		await assert.rejects(parseArniSkillLibrary(JSON.stringify({ ...valid, revision: '0'.repeat(64) })));
		await assert.rejects(parseArniSkillLibrary(JSON.stringify({ ...valid, files: [{ ...valid.files[0], text: 'modified command' }] })));
		await assert.rejects(parseArniSkillLibrary(JSON.stringify({ ...valid, files: [valid.files[0], valid.files[0]] })));
		await assert.rejects(parseArniSkillLibrary(' '.repeat(2 * 1024 * 1024 + 1)));
	});

	test('updates atomically, keeps running chats pinned, works offline and preserves editable copies', async () => {
		const log = new NullLogService();
		const files = store.add(new FileService(log));
		store.add(files.registerProvider('file', store.add(new InMemoryFileSystemProvider())));
		let body = JSON.stringify(await library());
		let offline = false;
		let primaryUnavailable = false;
		const requests = new class extends mock<IRequestService>() {
			override async request(options: IRequestOptions): Promise<IRequestContext> {
				assert.ok(['https://api.arnion.ru/api/skills/library', 'https://arni-backend.vercel.app/api/skills/library'].includes(options.url!));
				if (offline) { throw new Error('offline'); }
				if (primaryUnavailable && options.url?.startsWith('https://api.arnion.ru/')) { throw new Error('Proxy unavailable'); }
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(body)) };
			}
		};
		const environment = new class extends mock<IEnvironmentService>() { override cacheHome = URI.file('/profile'); };
		const window = () => new ArniSkillLibraryService(files, requests, environment, log);
		const initial = window();
		assert.strictEqual(await initial.getCurrent(), undefined);
		assert.strictEqual((await initial.update(CancellationToken.None)).changed, true);
		assert.strictEqual(await initial.getCurrent(), undefined, 'A discovered window keeps bundled prompts until reload');
		const firstWindow = window();
		const first = (await firstWindow.getCurrent())!;
		assert.strictEqual((await firstWindow.update(CancellationToken.None)).changed, false);
		body = JSON.stringify(await library('Updated skill'));
		await firstWindow.update(CancellationToken.None);
		assert.strictEqual((await firstWindow.getCurrent())!.library.revision, first.library.revision);
		const reloaded = window();
		const next = (await reloaded.getCurrent())!;
		assert.notStrictEqual(next.library.revision, first.library.revision);
		assert.strictEqual((await files.readFile(joinPath(first.root, first.library.files[0].path))).value.toString(), 'A useful skill');
		primaryUnavailable = true;
		assert.strictEqual((await reloaded.update(CancellationToken.None)).changed, false, 'Direct first-party endpoint is a fallback');
		offline = true;
		await assert.rejects(reloaded.update(CancellationToken.None));
		assert.strictEqual((await window().getCurrent())!.library.revision, next.library.revision);
		const project = URI.file('/project');
		await files.createFolder(project);
		await reloaded.copyForEditing(project);
		const custom = joinPath(project, '.github/skills/media-toolkit/SKILL.md');
		await files.writeFile(custom, VSBuffer.fromString('My own version'));
		await assert.rejects(reloaded.copyForEditing(project));
		assert.strictEqual((await files.readFile(custom)).value.toString(), 'My own version');
		await files.writeFile(joinPath(next.root, next.library.files[0].path), VSBuffer.fromString('Corrupted cache'));
		assert.strictEqual(await window().getCurrent(), undefined, 'Corrupt cache falls back to bundled skills');
	});
});

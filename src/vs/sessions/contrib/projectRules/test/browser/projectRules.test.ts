/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { $ } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { FileOperationError, FileOperationResult } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { ITextFileService } from '../../../../../workbench/services/textfile/common/textfiles.js';
import { IEditorGroupsService } from '../../../../../workbench/services/editor/common/editorGroupsService.js';
import { ITestTextFileEditorModelManager, TestTextFileService, workbenchInstantiationService } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { ProjectRulesEditorInput } from '../../browser/projectRulesEditorInput.js';
import { ProjectRulesEditor } from '../../browser/projectRulesEditor.js';

suite('Arni project rules', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const root = URI.file('/projects/creative');
	const resource = URI.joinPath(root, 'AGENTS.md');

	async function setup() {
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider('file', store.add(new InMemoryFileSystemProvider())));
		await files.createFolder(root);
		const instantiation = workbenchInstantiationService({ fileService: () => files }, store);
		instantiation.stub(IUserInteractionService, new MockUserInteractionService());
		const textFiles = instantiation.invokeFunction(accessor => accessor.get(ITextFileService)) as TestTextFileService;
		store.add(textFiles.files as ITestTextFileEditorModelManager);
		store.add(textFiles.files.onDidCreate(model => store.add(model)));
		return {
			files, textFiles, instantiation,
			input: (project = root) => store.add(instantiation.createInstance(ProjectRulesEditorInput, project)),
		};
	}

	test('opens existing rules unchanged and shares unsaved edits with the file working copy', async () => {
		const h = await setup();
		const original = '# Правила\n\nСуществующие инструкции.\n';
		await h.files.createFile(resource, VSBuffer.fromString(original));
		const input = h.input();
		const model = await input.resolve();
		assert.ok(model.isResolved());
		assert.deepStrictEqual({ content: model.textEditorModel.getValue(), dirty: input.isDirty() }, { content: original, dirty: false });
		model.textEditorModel.setValue(original + '\nИзображения 9:16.\n');
		const reopened = h.input();
		assert.strictEqual(await reopened.resolve(), model);
		assert.ok(reopened.isDirty());
		await input.save(0);
		assert.deepStrictEqual({ content: (await h.files.readFile(resource)).value.toString(), dirty: reopened.isDirty() }, { content: original + '\nИзображения 9:16.\n', dirty: false });
	});

	test('creates an empty AGENTS.md for a new project and isolates rules by project', async () => {
		const h = await setup();
		const otherRoot = URI.file('/projects/other');
		await h.files.createFolder(otherRoot);
		const input = h.input();
		const other = h.input(otherRoot);
		const model = await input.resolve();
		await other.resolve();
		assert.strictEqual((await h.files.readFile(resource)).value.toString(), '');
		assert.ok(!input.matches(other));
		assert.ok(model.isResolved());
		model.textEditorModel.setValue('Вертикальные изображения 9:16.');
		await input.save(0);
		assert.deepStrictEqual(await Promise.all([resource, other.resource].map(async uri => (await h.files.readFile(uri)).value.toString())), ['Вертикальные изображения 9:16.', '']);
	});

	test('keeps unsaved edits after a write failure and supports retry and revert', async () => {
		const h = await setup();
		const input = h.input();
		const model = await input.resolve();
		assert.ok(model.isResolved());
		model.textEditorModel.setValue('Keep these edits');
		h.textFiles.files.saveErrorHandler = { onSaveError() { } };
		h.textFiles.setWriteErrorOnce(new FileOperationError('Read only', FileOperationResult.FILE_PERMISSION_DENIED));
		assert.strictEqual(await input.save(0), undefined);
		assert.deepStrictEqual({ dirty: input.isDirty(), text: model.textEditorModel.getValue() }, { dirty: true, text: 'Keep these edits' });
		await input.save(0);
		model.textEditorModel.setValue('Discard this change');
		await input.revert();
		assert.deepStrictEqual({ dirty: input.isDirty(), text: model.textEditorModel.getValue() }, { dirty: false, text: 'Keep these edits' });
	});

	test('renders the selected project and saves from the editor button', async () => {
		const h = await setup();
		const group = h.instantiation.invokeFunction(accessor => accessor.get(IEditorGroupsService)).activeGroup;
		const editor = store.add(h.instantiation.createInstance(ProjectRulesEditor, group));
		const container = mainWindow.document.body.appendChild($('div'));
		try {
			editor.create(container);
			const input = h.input();
			await editor.setInput(input, undefined, { newInGroup: true }, CancellationToken.None);
			editor.getControl().getModel()!.setValue('Пиши на русском языке.');
			assert.ok(container.querySelector('.project-rules-project')?.textContent?.includes('creative'));
			const button = container.querySelector<HTMLElement>('.monaco-button')!;
			assert.strictEqual(button.getAttribute('aria-disabled'), 'false');
			const saved = new Promise<void>(resolve => store.add(h.textFiles.files.onDidSave(() => resolve())));
			button.click();
			await saved;
			assert.strictEqual((await h.files.readFile(resource)).value.toString(), 'Пиши на русском языке.');
			editor.clearInput();
		} finally {
			container.remove();
		}
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IPathService } from '../../../../../workbench/services/path/common/pathService.js';
import { StarterProjectGallery } from '../../browser/starterProjectGallery.js';

suite('StarterProjectGallery', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('project ideas get a folder with rules, task ideas open a chat, nothing is sent unasked', async () => {
		const hoverTips: string[] = [];
		const existingFolders = new Set<string>();
		const startedProjects: { readonly folder: string; readonly prompt: string; readonly professionId: string | undefined; readonly submit: boolean }[] = [];
		const startedTasks: { readonly prompt: string; readonly professionId: string }[] = [];
		const writtenFiles = new Map<string, string>();
		let existingFolderRequests = 0;
		let closeRequests = 0;
		const hoverService = new class extends mock<IHoverService>() {
			override setupDelayedHover(_target: HTMLElement, options: Parameters<IHoverService['setupDelayedHover']>[1]): IDisposable {
				const resolved = typeof options === 'function' ? options() : options;
				if (typeof resolved.content === 'string') {
					hoverTips.push(resolved.content);
				}
				return { dispose() { } };
			}
		}();
		const storageService = new class extends mock<IStorageService>() {
			override get(_key: string, _scope: StorageScope, fallbackValue: string): string;
			override get(_key: string, _scope: StorageScope, fallbackValue?: string): string | undefined;
			override get(_key: string, _scope: StorageScope, fallbackValue?: string): string | undefined {
				return fallbackValue;
			}
		}();
		const pathService = new class extends mock<IPathService>() {
			override userHome(options: { preferLocal: true }): URI;
			override userHome(options?: { preferLocal: boolean }): Promise<URI>;
			override userHome(options?: { preferLocal: boolean }): URI | Promise<URI> {
				const home = URI.file('/home/test');
				return options?.preferLocal ? home : Promise.resolve(home);
			}
		}();
		const container = document.createElement('div');
		const gallery = disposables.add(new StarterProjectGallery(
			container,
			async (folder, prompt, professionId, submit) => { startedProjects.push({ folder: folder.path, prompt, professionId, submit }); },
			async (prompt, professionId) => { startedTasks.push({ prompt, professionId }); },
			() => closeRequests++,
			() => existingFolderRequests++,
			upcastPartial<IFileDialogService>({}),
			upcastPartial<IFileService>({
				exists: async folder => existingFolders.has(folder.path),
				createFolder: async folder => {
					existingFolders.add(folder.path);
					return upcastPartial<IFileStatWithMetadata>({ resource: folder });
				},
				writeFile: async (file, content) => {
					writtenFiles.set(file.path, (content as VSBuffer).toString());
					return upcastPartial<IFileStatWithMetadata>({ resource: file });
				},
			}),
			hoverService,
			storageService,
			pathService,
			upcastPartial<ICommandService>({}),
		));
		const visibleCards = [...gallery.element.querySelectorAll<HTMLButtonElement>('.starter-project-card:not([hidden])')];
		assert.strictEqual(visibleCards[0].dataset.agentId, 'programmer');
		assert.ok(visibleCards[0].textContent?.includes('Программист'));
		visibleCards[0].click();
		await timeout(0);
		visibleCards[0].click();
		await timeout(0);
		gallery.element.querySelector<HTMLTextAreaElement>('.starter-project-idea-input')!.value = 'сайт для кофейни';
		gallery.element.querySelector<HTMLButtonElement>('.starter-project-create')!.click();
		await timeout(0);
		gallery.element.querySelector<HTMLButtonElement>('.starter-project-existing')!.click();
		gallery.element.querySelector<HTMLButtonElement>('.starter-project-back')!.click();
		const countVisible = () => gallery.element.querySelectorAll('.starter-project-card:not([hidden])').length;
		const more = gallery.element.querySelector<HTMLButtonElement>('.starter-project-more')!;
		more.click();
		const expanded = { cards: countVisible(), label: more.textContent };
		more.click();
		const collapsed = { cards: countVisible(), label: more.textContent };

		const researcher = visibleCards[1];
		researcher.click();
		await timeout(0);
		const rules = writtenFiles.get('/home/test/Arni Projects/landing-page/AGENTS.md') ?? '';
		assert.deepStrictEqual({
			visibleCards: visibleCards.length,
			hoverTips: hoverTips.filter(tip => tip.length > 0).length,
			started: startedProjects.map(project => ({ folder: project.folder, professionId: project.professionId, submit: project.submit, prompt: project.prompt })),
			tasks: startedTasks,
			rulesFiles: [...writtenFiles.keys()],
			rulesMentionIndexHtml: rules.includes('index.html'),
			existingFolderRequests,
			closeRequests,
			expanded,
			collapsed,
		}, {
			visibleCards: 6,
			hoverTips: 15,
			started: [
				{ folder: '/home/test/Arni Projects/landing-page', professionId: 'programmer', submit: false, prompt: 'Сделай лендинг для ' },
				{ folder: '/home/test/Arni Projects/landing-page-2', professionId: 'programmer', submit: false, prompt: 'Сделай лендинг для ' },
				{ folder: '/home/test/Arni Projects/my-project', professionId: 'programmer', submit: true, prompt: 'сайт для кофейни' },
			],
			tasks: [{ prompt: 'Сравни источники по теме: ', professionId: 'researcher' }],
			rulesFiles: [
				'/home/test/Arni Projects/landing-page/AGENTS.md',
				'/home/test/Arni Projects/landing-page-2/AGENTS.md',
				'/home/test/Arni Projects/my-project/AGENTS.md',
			],
			rulesMentionIndexHtml: true,
			existingFolderRequests: 1,
			closeRequests: 1,
			expanded: { cards: 15, label: 'Свернуть' },
			collapsed: { cards: 6, label: 'Все идеи' },
		});
	});

	test('own files in the save location are offered instead of an empty project folder', async () => {
		const parent = URI.file('/home/test/Урок06');
		const existingFolders = new Set<string>([parent.path]);
		const startedProjects: { readonly folder: string; readonly prompt: string; readonly professionId: string | undefined; readonly submit: boolean }[] = [];
		const child = (name: string, isDirectory: boolean) => upcastPartial<IFileStatWithMetadata>({ name, isDirectory });
		const gallery = disposables.add(new StarterProjectGallery(
			document.createElement('div'),
			async (folder, prompt, professionId, submit) => { startedProjects.push({ folder: folder.path, prompt, professionId, submit }); },
			async () => { },
			() => { },
			() => { },
			upcastPartial<IFileDialogService>({}),
			upcastPartial<IFileService>({
				exists: async folder => existingFolders.has(folder.path),
				resolve: async folder => upcastPartial<IFileStatWithMetadata>({
					resource: folder,
					children: [child('06_Sales-october.xlsx', false), child('06_Support-october.docx', false), child('desktop.ini', false), child('.DS_Store', false), child('Старое', true)],
				}),
				createFolder: async folder => {
					existingFolders.add(folder.path);
					return upcastPartial<IFileStatWithMetadata>({ resource: folder });
				},
				writeFile: async file => upcastPartial<IFileStatWithMetadata>({ resource: file }),
			}),
			upcastPartial<IHoverService>({ setupDelayedHover: () => ({ dispose() { } }) }),
			upcastPartial<IStorageService>({ get: () => parent.toString() }),
			new class extends mock<IPathService>() {
				override userHome(options: { preferLocal: true }): URI;
				override userHome(options?: { preferLocal: boolean }): Promise<URI>;
				override userHome(options?: { preferLocal: boolean }): URI | Promise<URI> {
					const home = URI.file('/home/test');
					return options?.preferLocal ? home : Promise.resolve(home);
				}
			}(),
			upcastPartial<ICommandService>({}),
		));
		const input = gallery.element.querySelector<HTMLTextAreaElement>('.starter-project-idea-input')!;
		const create = gallery.element.querySelector<HTMLButtonElement>('.starter-project-create')!;
		const notice = () => gallery.element.querySelector('.starter-project-files-notice');

		input.value = 'сводный отчёт';
		create.click();
		await timeout(0);
		const warning = notice()?.querySelector('.starter-project-files-notice-text')?.textContent;
		notice()!.querySelector<HTMLButtonElement>('.starter-project-use-folder')!.click();
		await timeout(0);
		const noticeAfterUse = !!notice();

		input.value = 'сайт';
		create.click();
		await timeout(0);
		input.dispatchEvent(new Event('input'));
		const noticeAfterEdit = !!notice();
		create.click();
		await timeout(0);
		notice()!.querySelector<HTMLButtonElement>('.starter-project-create-anyway')!.click();
		await timeout(0);

		assert.deepStrictEqual({ warning, noticeAfterUse, noticeAfterEdit, startedProjects }, {
			warning: `В папке ${parent.fsPath} уже есть ваши файлы: 06_Sales-october.xlsx, 06_Support-october.docx. Новый проект создаст рядом пустую папку, и агент этих файлов не увидит.`,
			noticeAfterUse: false,
			noticeAfterEdit: false,
			startedProjects: [
				{ folder: '/home/test/Урок06', prompt: 'сводный отчёт', professionId: undefined, submit: true },
				{ folder: '/home/test/Урок06/my-project', prompt: 'сайт', professionId: 'programmer', submit: true },
			],
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IPathService } from '../../../../../workbench/services/path/common/pathService.js';
import { StarterProjectGallery } from '../../browser/starterProjectGallery.js';

suite('StarterProjectGallery', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('creates a fresh folder per start and hands the prompt to the agent', async () => {
		const hoverTips: string[] = [];
		const existingFolders = new Set<string>();
		const startedProjects: { readonly folder: string; readonly prompt: string }[] = [];
		let existingFolderRequests = 0;
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
			async (folder, prompt) => { startedProjects.push({ folder: folder.path, prompt }); },
			() => existingFolderRequests++,
			upcastPartial<IFileDialogService>({}),
			upcastPartial<IFileService>({
				exists: async folder => existingFolders.has(folder.path),
				createFolder: async folder => {
					existingFolders.add(folder.path);
					return upcastPartial<IFileStatWithMetadata>({ resource: folder });
				},
			}),
			hoverService,
			storageService,
			pathService,
		));
		const visibleCards = [...gallery.element.querySelectorAll<HTMLButtonElement>('.starter-project-card:not([hidden])')];
		visibleCards[0].click();
		await timeout(0);
		visibleCards[0].click();
		await timeout(0);
		gallery.element.querySelector<HTMLTextAreaElement>('.starter-project-idea-input')!.value = 'сайт для кофейни';
		gallery.element.querySelector<HTMLButtonElement>('.starter-project-create')!.click();
		await timeout(0);
		gallery.element.querySelector<HTMLButtonElement>('.starter-project-existing')!.click();

		assert.deepStrictEqual({
			visibleCards: visibleCards.length,
			hoverTips: hoverTips.filter(tip => tip.length > 0).length,
			started: startedProjects.map(project => ({ folder: project.folder, mentionsIdea: project.prompt.includes('Змейка') || project.prompt.includes('сайт для кофейни') })),
			existingFolderRequests,
		}, {
			visibleCards: 3,
			hoverTips: 6,
			started: [
				{ folder: '/home/test/Arni Projects/snake-game', mentionsIdea: true },
				{ folder: '/home/test/Arni Projects/snake-game-2', mentionsIdea: true },
				{ folder: '/home/test/Arni Projects/my-project', mentionsIdea: true },
			],
			existingFolderRequests: 1,
		});
	});
});

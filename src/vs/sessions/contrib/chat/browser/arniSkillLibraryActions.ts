/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isCancellationError } from '../../../../base/common/errors.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IHostService } from '../../../../workbench/services/host/browser/host.js';
import { AI_CUSTOMIZATION_MANAGEMENT_EDITOR_ID } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationManagement.js';
import { IArniSkillLibraryService } from './arniSkillLibraryService.js';

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'arni.updateSkillLibrary', title: localize2('arni.updateSkillLibrary', 'Обновить библиотеку навыков'), category: localize2('arni.category', 'Арни'), f1: true,
			icon: Codicon.cloudDownload, menu: [{ id: MenuId.EditorTitle, when: ContextKeyExpr.equals('activeEditor', AI_CUSTOMIZATION_MANAGEMENT_EDITOR_ID), group: 'navigation', order: 30 }] });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const library = accessor.get(IArniSkillLibraryService);
		const notifications = accessor.get(INotificationService);
		const host = accessor.get(IHostService);
		const progress = accessor.get(IProgressService);
		const resources = new DisposableStore();
		try {
			const cancellation = resources.add(new CancellationTokenSource());
			const result = await progress.withProgress({ location: ProgressLocation.Notification, cancellable: true,
				title: localize('arni.libraryDownloading', 'Загрузка библиотеки навыков Арни…') }, () => library.update(cancellation.token), () => cancellation.cancel());
			if (result.changed) {
				notifications.prompt(Severity.Info, localize('arni.libraryUpdated', 'Библиотека загружена. Перезагрузите окно, чтобы новые чаты увидели обновление. Текущие чаты сохраняют свою версию.'),
					[{ label: localize('arni.reloadLibrary', 'Перезагрузить окно'), run: () => host.reload() }]);
			} else {
				notifications.info(localize('arni.libraryCurrent', 'Установлена актуальная версия библиотеки навыков.'));
			}
		} catch (error) {
			if (isCancellationError(error)) { return; }
			notifications.error(localize('arni.libraryUpdateFailed', 'Не удалось обновить библиотеку. Сохранены установленные и встроенные навыки. {0}', error instanceof Error ? error.message : String(error)));
		} finally {
			resources.dispose();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'arni.copySkillLibrary', title: localize2('arni.copySkillLibrary', 'Создать редактируемую копию навыков в проекте'), category: localize2('arni.category', 'Арни'), f1: true,
			icon: Codicon.copy, menu: [{ id: MenuId.EditorTitle, when: ContextKeyExpr.equals('activeEditor', AI_CUSTOMIZATION_MANAGEMENT_EDITOR_ID), group: 'navigation', order: 31 }] });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const library = accessor.get(IArniSkillLibraryService);
		const notifications = accessor.get(INotificationService);
		const folders = await accessor.get(IFileDialogService).showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
			title: localize('arni.copyLibraryFolder', 'Папка проекта для редактируемой копии библиотеки') });
		if (!folders?.length) { return; }
		try {
			await library.copyForEditing(folders[0]);
			notifications.info(localize('arni.libraryCopied', 'Копия сохранена в .github/skills и .github/agents выбранного проекта. Её можно редактировать; обновления библиотеки её не заменят.'));
		} catch (error) {
			notifications.error(localize('arni.libraryCopyFailed', 'Не удалось создать копию: {0}', error instanceof Error ? error.message : String(error)));
		}
	}
});

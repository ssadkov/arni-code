/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../workbench/browser/editor.js';
import { EditorExtensions } from '../../../../workbench/common/editor.js';
import { IAICustomizationWorkspaceService } from '../../../../workbench/contrib/chat/common/aiCustomizationWorkspaceService.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { Menus } from '../../../browser/menus.js';
import { IActiveSession } from '../../../services/sessions/common/sessionsManagement.js';
import { ProjectRulesEditor } from './projectRulesEditor.js';
import { ProjectRulesEditorInput } from './projectRulesEditorInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(ProjectRulesEditor, ProjectRulesEditor.ID, localize('arni.projectRules.title', "Правила проекта")),
	[new SyncDescriptor(ProjectRulesEditorInput)],
);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'arni.openProjectRules',
			title: localize2('arni.projectRules.title', "Правила проекта"),
			category: localize2('arni.category', "Арни"),
			f1: true,
			icon: Codicon.book,
			menu: [
				{ id: Menus.SidebarCustomizations, group: 'navigation', order: 4.5 },
				{ id: Menus.SessionHeaderContext, group: '2_edit', order: 3 },
			],
		});
	}

	async run(accessor: ServicesAccessor, context?: IActiveSession): Promise<void> {
		const workspaceService = accessor.get(IAICustomizationWorkspaceService);
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const fileDialogService = accessor.get(IFileDialogService);
		let root: URI | undefined = context?.workspace?.get()?.folders[0]?.workingDirectory
			?? workspaceService.getActiveProjectRoot()
			?? accessor.get(IWorkspaceContextService).getWorkspace().folders[0]?.uri;
		if (!root) {
			root = (await fileDialogService.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				title: localize('arni.projectRules.chooseProject', "Выберите проект для редактирования правил"),
			}))?.[0];
		}
		if (root) {
			await editorService.openEditor(instantiationService.createInstance(ProjectRulesEditorInput, root), { pinned: true });
		}
	}
});

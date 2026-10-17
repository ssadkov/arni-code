/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../workbench/browser/editor.js';
import { EditorExtensions } from '../../../../workbench/common/editor.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { ArniAccountSignedInContext } from '../../../../workbench/services/authentication/common/arniProductAuth.js';
import { Menus } from '../../../browser/menus.js';
import { ArniUserProfileEditor, ArniUserProfileEditorInput } from './arniUserProfileEditor.js';
import { ArniUserProfileService, IArniUserProfileService } from './arniUserProfileService.js';
import './arniUserProfileTools.js';

registerSingleton(IArniUserProfileService, ArniUserProfileService, InstantiationType.Delayed);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(ArniUserProfileEditor, ArniUserProfileEditor.ID, localize('arni.profile.title', 'Мои данные')),
	[new SyncDescriptor(ArniUserProfileEditorInput)],
);

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'arni.openUserProfile', title: localize2('arni.profile.title', 'Мои данные'), category: localize2('arni.category', 'Арни'), f1: true, icon: Codicon.account,
			menu: { id: Menus.AccountMenu, group: '2_settings', order: 0, when: ArniAccountSignedInContext } });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(accessor.get(IInstantiationService).createInstance(ArniUserProfileEditorInput), { pinned: true });
	}
});


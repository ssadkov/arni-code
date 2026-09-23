/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMobile, isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import product from '../../../../platform/product/common/product.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../../workbench/services/layout/browser/layoutService.js';
import { HISTORY_VIEW_PANE_ID, REPOSITORIES_VIEW_PANE_ID, VIEW_PANE_ID } from '../../../../workbench/contrib/scm/common/scm.js';
import { LayoutController, RESPONSIVE_SIDEBAR_SETTING } from './desktopSessionLayoutController.js';
import { MobileLayoutController } from './mobileSessionLayoutController.js';
import { DOCK_DETAIL_PANEL_SETTING } from '../../../common/sessionConfig.js';
import { IAgentWorkbenchLayoutService } from '../../../browser/workbench.js';
import { SinglePaneLayoutController } from './singlePaneLayoutController.js';

class SessionsLayoutContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sessionsLayoutContribution';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IAgentWorkbenchLayoutService layoutService: IAgentWorkbenchLayoutService,
	) {
		super();

		if (layoutService.isSinglePaneLayoutEnabled) {
			this._register(instantiationService.createInstance(SinglePaneLayoutController));
			return;
		}

		if (isWeb && isMobile) {
			this._register(instantiationService.createInstance(MobileLayoutController));
			return;
		}

		this._register(instantiationService.createInstance(LayoutController));
	}
}

registerWorkbenchContribution2(SessionsLayoutContribution.ID, SessionsLayoutContribution, WorkbenchPhase.BlockRestore);

const AGENT_CHROME_DEFAULTS_KEY = 'agents.firstScreen.chromeDefaultsApplied';

/**
 * Hides the activity bar and Source Control until the user opens them.
 * Applied once per Agents workspace so a later manual reveal stays put.
 */
class AgentFirstScreenChromeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.agentFirstScreenChrome';

	constructor(
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IViewsService viewsService: IViewsService,
	) {
		super();
		if (storageService.getBoolean(AGENT_CHROME_DEFAULTS_KEY, StorageScope.WORKSPACE, false)) {
			return;
		}
		storageService.store(AGENT_CHROME_DEFAULTS_KEY, true, StorageScope.WORKSPACE, StorageTarget.USER);
		layoutService.setPartHidden(true, Parts.ACTIVITYBAR_PART);
		for (const viewId of [VIEW_PANE_ID, REPOSITORIES_VIEW_PANE_ID, HISTORY_VIEW_PANE_ID]) {
			viewsService.closeView(viewId);
		}
	}
}

registerWorkbenchContribution2(AgentFirstScreenChromeContribution.ID, AgentFirstScreenChromeContribution, WorkbenchPhase.AfterRestored);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'sessions',
	properties: {
		[RESPONSIVE_SIDEBAR_SETTING]: {
			type: 'boolean',
			markdownDescription: localize('sessions.layout.autoCollapseSessionsSidebar', "Controls whether the sessions sidebar is automatically collapsed in a narrow Agents window while both the editor and the side panel are open, and shown again once either of them closes."),
			default: product.quality !== 'stable',
			tags: ['experimental'],
			experiment: { mode: 'auto' }
		},
		[DOCK_DETAIL_PANEL_SETTING]: {
			type: 'boolean',
			markdownDescription: localize('sessions.layout.singlePaneDetailPanel', "Controls whether the Agents window docks the detail panel inside the editor so a single editor tab bar spans across the editor and the detail panel. Requires a window reload to take effect."),
			default: true,
			tags: ['experimental'],
			experiment: { mode: 'startup' }
		},
	},
});

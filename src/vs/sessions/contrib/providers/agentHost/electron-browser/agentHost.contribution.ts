/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { DebugAgentHostInDevToolsAction } from '../../../../../workbench/contrib/chat/electron-browser/actions/debugAgentHostAction.js';
import '../../../../../workbench/contrib/chat/electron-browser/actions/exportAgentHostDebugLogsService.js';
import { ProfileAgentHostAction, StopAgentHostProfileAction } from '../../../../../workbench/contrib/chat/electron-browser/actions/profileAgentHostAction.js';
import { RestartLocalAgentHostAction } from '../../../../../workbench/contrib/chat/electron-browser/actions/restartAgentHostAction.js';
import { ArniWebSearchAuthContribution } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentHost/agentHostWebSearchAuth.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';

// The Agents window does not load the workbench agent host contribution, so without this
// the shared host never receives the Arni token and web search and images report a missing sign-in.
registerWorkbenchContribution2(ArniWebSearchAuthContribution.ID, ArniWebSearchAuthContribution, WorkbenchPhase.AfterRestored);

registerAction2(DebugAgentHostInDevToolsAction);
registerAction2(RestartLocalAgentHostAction);
registerAction2(ProfileAgentHostAction);
registerAction2(StopAgentHostProfileAction);

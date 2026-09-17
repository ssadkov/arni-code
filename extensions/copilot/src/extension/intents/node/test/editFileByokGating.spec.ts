/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { MockEndpoint } from '../../../../platform/endpoint/test/node/mockEndpoint';
import { MockAuthenticationService } from '../../../../platform/ignore/node/test/mockAuthenticationService';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { NullWorkspaceFileIndex } from '../../../../platform/workspaceChunkSearch/node/nullWorkspaceFileIndex';
import { IWorkspaceFileIndex } from '../../../../platform/workspaceChunkSearch/node/workspaceFileIndex';
import { URI } from '../../../../util/vs/base/common/uri';
import { SyncDescriptor } from '../../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { TestChatRequest } from '../../../test/node/testHelpers';
import { ToolName } from '../../../tools/common/toolNames';
import { getAgentTools } from '../agentIntent';

function hasTool(tools: readonly { name: string }[], name: ToolName): boolean {
	return tools.some(t => t.name === name);
}

describe('getAgentTools hides insert_edit_into_file without a Copilot token', () => {
	let accessor: ITestingServicesAccessor;
	let instantiationService: IInstantiationService;
	let endpoint: IChatEndpoint;

	beforeAll(() => {
		const services = createExtensionUnitTestingServices();
		services.define(IWorkspaceFileIndex, new SyncDescriptor(NullWorkspaceFileIndex));
		services.define(IWorkspaceService, new SyncDescriptor(
			TestWorkspaceService,
			[
				[URI.file('/workspace')],
				[]
			]
		));
		services.define(IAuthenticationService, new MockAuthenticationService());
		accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
		endpoint = instantiationService.createInstance(MockEndpoint, 'gpt-4o');
	});

	afterAll(() => {
		accessor.dispose();
	});

	test('hides insert_edit_into_file when hasCopilotTokenSource is false', async () => {
		const tools = await instantiationService.invokeFunction(getAgentTools, new TestChatRequest('create calculator.html'), endpoint);
		expect(hasTool(tools, ToolName.EditFile)).toBe(false);
		expect(hasTool(tools, ToolName.CreateFile)).toBe(true);
	});
});

describe('getAgentTools keeps insert_edit_into_file when a Copilot token source exists', () => {
	let accessor: ITestingServicesAccessor;
	let instantiationService: IInstantiationService;
	let endpoint: IChatEndpoint;

	beforeAll(() => {
		const services = createExtensionUnitTestingServices();
		services.define(IWorkspaceFileIndex, new SyncDescriptor(NullWorkspaceFileIndex));
		services.define(IWorkspaceService, new SyncDescriptor(
			TestWorkspaceService,
			[
				[URI.file('/workspace')],
				[]
			]
		));
		accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
		endpoint = instantiationService.createInstance(MockEndpoint, 'gpt-4o');
	});

	afterAll(() => {
		accessor.dispose();
	});

	test('exposes insert_edit_into_file for gpt-4o with static Copilot auth', async () => {
		const tools = await instantiationService.invokeFunction(getAgentTools, new TestChatRequest('create calculator.html'), endpoint);
		expect(hasTool(tools, ToolName.EditFile)).toBe(true);
	});
});

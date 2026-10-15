/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { ILanguageModelChatMetadata, ILanguageModelsService } from '../../../contrib/chat/common/languageModels.js';
import { ILanguageModelToolsService, IToolImpl, IToolInvocation } from '../../../contrib/chat/common/tools/languageModelToolsService.js';
import { TestProductService } from '../../../test/common/workbenchTestServices.js';
import { MainThreadLanguageModelTools } from '../../browser/mainThreadLanguageModelTools.js';
import { ExtHostLanguageModelToolsShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadLanguageModelTools', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('image tools receive the original BYOK model rather than the agent-host picker copy', async () => {
		const original = 'openrouter/us.anthropic.claude-sonnet-4-6';
		const picker = `agent-host-copilot:${original}`;
		let implementation: IToolImpl | undefined;
		const forwarded: Array<string | undefined> = [];
		const image = VSBuffer.fromString('image-bytes');
		const tools = new class extends mock<ILanguageModelToolsService>() {
			override readonly onDidChangeTools = Event.None;
			override registerToolImplementation(_id: string, tool: IToolImpl) {
				implementation = tool;
				return toDisposable(() => { implementation = undefined; });
			}
		};
		const models = new class extends mock<ILanguageModelsService>() {
			override lookupLanguageModel(id: string) {
				return id === picker ? { byokModelIdentifier: original } as ILanguageModelChatMetadata : undefined;
			}
		};
		const proxy: Partial<ExtHostLanguageModelToolsShape> = {
			$invokeTool: async dto => {
				// The extension host can resolve the extension model, not its main-thread-only copy.
				assert.notStrictEqual(dto.modelId, picker, 'Language model unavailable');
				forwarded.push(dto.modelId);
				return { content: [{ kind: 'data', value: { mimeType: 'image/png', data: image } }] };
			},
		};
		const bridge = store.add(new MainThreadLanguageModelTools(SingleProxyRPCProtocol(proxy), tools, new NullLogService(), TestProductService, models));
		bridge.$registerTool('copilot_viewImage', false);
		assert.ok(implementation);
		for (const modelId of [picker, original, 'native-model', undefined]) {
			const invocation: IToolInvocation = { callId: 'view-frame', toolId: 'copilot_viewImage', parameters: { filePath: '/project/frame.png' }, modelId, context: undefined };
			const result = await implementation.invoke(invocation, async () => 0, { report: () => { } }, CancellationToken.None);
			assert.deepStrictEqual(result.content, [{ kind: 'data', value: { mimeType: 'image/png', data: image } }]);
			assert.strictEqual(invocation.modelId, modelId, 'the chat model selection must stay unchanged');
		}
		assert.deepStrictEqual(forwarded, [original, original, 'native-model', undefined]);
	});
});

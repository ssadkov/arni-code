/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { CreateFileTool } from '../createFileTool';
import { toolResultToString } from './toolTestUtils';

describe('CreateFileTool', () => {
	it('writes the file directly when an agent host session provides no response stream', async () => {
		const accessor = createExtensionUnitTestingServices().createTestingAccessor();
		const tool = accessor.get(IInstantiationService).createInstance(CreateFileTool);
		const fileSystem = accessor.get(IFileSystemService) as MockFileSystemService;
		const uri = URI.file('/workspace/work/spec.json');

		const result = await tool.invoke({ input: { filePath: uri.fsPath, content: '{"имя": "ТОО"}' }, toolInvocationToken: null as never }, CancellationToken.None);

		expect(new TextDecoder().decode(await fileSystem.readFile(uri))).toBe('{"имя": "ТОО"}');
		expect(await toolResultToString(accessor, result)).toContain('File created at');
		accessor.dispose();
	});
});

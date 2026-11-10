/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../../base/test/common/utils.js';
import { ExtensionIdentifier } from '../../../../../../../../platform/extensions/common/extensions.js';
import { getArniModelPickerView } from '../../../../../browser/widget/input/modelPicker/arniModelPickerFilter.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../../../../common/languageModels.js';

function model(metadataId: string): ILanguageModelChatMetadataAndIdentifier {
	return {
		identifier: `copilotcli/${metadataId}`,
		metadata: {
			extension: new ExtensionIdentifier('test.extension'),
			id: metadataId,
			name: metadataId,
			vendor: 'copilotcli',
			version: '1.0',
			family: 'test',
			maxInputTokens: 1,
			maxOutputTokens: 1,
			isDefaultForLocation: {},
		},
	};
}

suite('Arni model picker filter', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const free = model('openrouter/nvidia/nemotron-3-ultra-550b-a55b:free');
	const recommended = model('openrouter/anthropic/claude-sonnet-5.5');
	const other = model('openrouter/acme/obscure-model');
	const bedrock = model('openrouter/global.anthropic.claude-sonnet-4-6');

	function summary(models: ILanguageModelChatMetadataAndIdentifier[], freeOnly: boolean, selected?: string, recommendedIds?: string[]) {
		const view = getArniModelPickerView(models, freeOnly, selected, recommendedIds);
		return { models: view.models.map(item => item.metadata.id), featured: Object.keys(view.featured), toggle: view.showFreeToggle };
	}

	test('leads with the models the backend recommends, free and paid alike', () => {
		const backend = ['nvidia/nemotron-3-ultra-550b-a55b:free', 'global.anthropic.claude-sonnet-4-6'];
		assert.deepStrictEqual({
			mixed: summary([free, bedrock, recommended, other], false, undefined, backend),
			freeOnly: summary([free, bedrock, other], true, undefined, backend),
			emptyFallsBack: summary([free, bedrock, recommended], false, undefined, []),
		}, {
			mixed: { models: [free.metadata.id, bedrock.metadata.id, recommended.metadata.id, other.metadata.id], featured: [free.metadata.id, bedrock.metadata.id], toggle: true },
			freeOnly: { models: [free.metadata.id], featured: [free.metadata.id], toggle: true },
			emptyFallsBack: { models: [free.metadata.id, bedrock.metadata.id, recommended.metadata.id], featured: [recommended.metadata.id], toggle: true },
		});
	});

	test('leads with recommended paid models, filters to free on demand, and leaves other catalogs alone', () => {
		assert.deepStrictEqual({
			mixed: summary([free, recommended, other], false),
			freeOnly: summary([free, recommended, other], true),
			freeOnlyKeepsSelection: summary([free, recommended, other], true, other.identifier),
			freeCatalog: summary([free], false),
			otherCatalog: summary([recommended, other], true),
		}, {
			mixed: { models: [free.metadata.id, recommended.metadata.id, other.metadata.id], featured: [recommended.metadata.id], toggle: true },
			freeOnly: { models: [free.metadata.id], featured: [free.metadata.id], toggle: true },
			freeOnlyKeepsSelection: { models: [free.metadata.id, other.metadata.id], featured: [free.metadata.id], toggle: true },
			freeCatalog: { models: [free.metadata.id], featured: [free.metadata.id], toggle: false },
			otherCatalog: { models: [recommended.metadata.id, other.metadata.id], featured: [], toggle: false },
		});
	});
});

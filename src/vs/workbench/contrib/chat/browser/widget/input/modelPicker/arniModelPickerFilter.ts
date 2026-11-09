/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../../../../../../base/common/collections.js';
import { IModelControlEntry, ILanguageModelChatMetadataAndIdentifier } from '../../../../common/languageModels.js';
import { isAutoModel } from './modelPickerPresentation.js';

/** Remembers whether the picker lists only free models. */
export const ARNI_FREE_ONLY_STORAGE_KEY = 'chat.modelPicker.arniFreeOnly';

/** OpenRouter marks free variants with this suffix; the Arni backend offers no other free models. */
const FREE_MODEL_SUFFIX = ':free';

/**
 * Paid models the picker leads with. The full catalog has hundreds of models;
 * the rest stay folded under "Other Models" and are still found by search.
 */
const RECOMMENDED_PAID_MODELS: readonly string[] = [
	'anthropic/claude-sonnet-5.5',
	'anthropic/claude-haiku-5.5',
	'openai/gpt-6.1-terra',
	'google/gemini-3.8-flash',
	'deepseek/deepseek-v4.1-flash',
	'z-ai/glm-5.3',
];

/** What the picker shows for an Arni (OpenRouter) catalog. */
export interface IArniModelPickerView {
	readonly models: readonly ILanguageModelChatMetadataAndIdentifier[];
	/** Models to lead the list with, in the shape of the curated control entries. */
	readonly featured: IStringDictionary<IModelControlEntry>;
	/** Whether the "Free only" toggle applies: the catalog mixes free and paid models. */
	readonly showFreeToggle: boolean;
}

function isFreeModel(model: ILanguageModelChatMetadataAndIdentifier): boolean {
	return model.metadata.id.endsWith(FREE_MODEL_SUFFIX);
}

/** Agent host copies prefix the catalog id with the provider, e.g. `openrouter/`. */
function isRecommendedPaidModel(model: ILanguageModelChatMetadataAndIdentifier): boolean {
	return RECOMMENDED_PAID_MODELS.some(id => model.metadata.id === id || model.metadata.id.endsWith(`/${id}`));
}

/**
 * Narrows an Arni catalog to a short list. Leaves any other catalog, one without
 * free OpenRouter models, as it is. The selected model always stays listed.
 */
export function getArniModelPickerView(models: readonly ILanguageModelChatMetadataAndIdentifier[], freeOnly: boolean, selectedModelId: string | undefined): IArniModelPickerView {
	const chatModels = models.filter(model => !isAutoModel(model));
	if (!chatModels.some(isFreeModel)) {
		return { models, featured: {}, showFreeToggle: false };
	}
	const showFreeToggle = chatModels.some(model => !isFreeModel(model));
	const onlyFree = freeOnly || !showFreeToggle;
	const visible = onlyFree
		? models.filter(model => isFreeModel(model) || isAutoModel(model) || model.identifier === selectedModelId)
		: models;
	const featured: IStringDictionary<IModelControlEntry> = {};
	for (const model of visible) {
		if (onlyFree ? isFreeModel(model) : isRecommendedPaidModel(model)) {
			featured[model.metadata.id] = { label: model.metadata.name, featured: true, exists: true };
		}
	}
	return { models: visible, featured, showFreeToggle };
}

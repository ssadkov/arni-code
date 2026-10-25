/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ToolDefinition } from '../../../../../../platform/agentHost/common/state/protocol/state.js';
import type { IToolData } from '../../../common/tools/languageModelToolsService.js';
import { localize } from '../../../../../../nls.js';

/** Checks the basic object contract before an extension dereferences tool parameters. */
export function getToolInputError(tool: IToolData, parameters: Record<string, unknown>): string | undefined {
	const schema = tool.inputSchema;
	if (!schema || schema.type !== 'object') {
		return undefined;
	}
	const required = schema.required ?? [];
	const missing = required.filter(name => !Object.hasOwn(parameters, name));
	if (missing.length) {
		return localize('agentHost.toolInput.missing', "Missing required parameters: {0}. Required parameters are: {1}. Use these exact names from the tool schema; do not repeat the same invalid input.", missing.join(', '), required.join(', '));
	}
	for (const [name, value] of Object.entries(parameters)) {
		const type = schema.properties?.[name]?.type;
		if (!type) {
			continue;
		}
		const types = Array.isArray(type) ? type : [type];
		const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
		if (!types.some(expected => expected === actual || (expected === 'integer' && typeof value === 'number' && Number.isInteger(value)))) {
			return localize('agentHost.toolInput.type', "Parameter \"{0}\" must have type {1}. Use the declared tool schema; do not repeat the same invalid input.", name, types.join(' | '));
		}
	}
	return undefined;
}

/**
 * Converts an internal {@link IToolData} to a protocol {@link ToolDefinition}.
 */
export function toolDataToDefinition(tool: IToolData): ToolDefinition {
	const definition: ToolDefinition = {
		name: tool.toolReferenceName ?? tool.id,
		title: tool.displayName,
		description: tool.modelDescription,
	};
	if (tool.inputSchema?.type === 'object') {
		definition.inputSchema = tool.inputSchema as ToolDefinition['inputSchema'];
	}
	return definition;
}

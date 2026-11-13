/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { localize } from '../../../../nls.js';
import { dirname, isAbsolute, relative, resolve, sep } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ImageServerToolName } from '../../common/serverToolNames.js';
import type { IAgentServerToolDefinition } from '../../common/agentServerTools.js';
import type { ToolDefinition } from '../../common/state/sessionState.js';
import { getEffectiveWorkingDirectory } from '../agentConfigurationService.js';
import type { IServerToolDisplay, IServerToolGroup } from './agentServerToolHost.js';

const maxPromptLength = 10_000;
const defaultAspectRatio = '16:9';
const aspectRatios = ['16:9', '1:1', '21:9', '2:3', '3:2', '4:5', '5:4', '9:16', '9:21'] as const;

/** Backend model ids. `simple` is the cheap default; `text` draws legible lettering. */
export const imageModels = {
	simple: { id: 'stability.stable-image-core-v1:1', label: 'Stable Image Core', priceUsd: 0.04 },
	text: { id: 'stability.sd3-5-large-v1:0', label: 'Stable Diffusion 3.5 Large', priceUsd: 0.08 },
} as const;

export type ImageKind = keyof typeof imageModels;

export interface IImageRequest {
	readonly prompt: string;
	readonly path: string;
	readonly kind: ImageKind;
	readonly aspectRatio: string;
}

export interface IGeneratedImage {
	readonly bytes: Uint8Array;
	readonly costMicros: number | null;
}

/** Host service that generates one image through the shared Arni API. */
export interface IImageServerToolAccessor {
	readonly isEnabled: () => boolean;
	/**
	 * `requestKey` makes a retried call return the already paid image instead of charging again.
	 * `chatId` puts the charge on the chat's spend, next to its model requests.
	 */
	readonly generate: (request: IImageRequest, requestKey: string, chatId?: string) => Promise<IGeneratedImage>;
}

const generateImageInputSchema: ToolDefinition['inputSchema'] = {
	type: 'object',
	properties: {
		prompt: { type: 'string', description: 'Image description in English. The image models reject Cyrillic, so translate a Russian request before calling.' },
		path: { type: 'string', description: 'Relative path of the new PNG inside the working directory, for example images/cat.png. An existing file is never overwritten.' },
		kind: { type: 'string', enum: ['simple', 'text'], description: `simple (default, $${imageModels.simple.priceUsd}): pictures and illustrations, any lettering comes out unreadable. text ($${imageModels.text.priceUsd}): when the image must contain readable words such as a logo or a title.` },
		aspect_ratio: { type: 'string', enum: [...aspectRatios], description: `Aspect ratio. Defaults to ${defaultAspectRatio}.` },
	},
	required: ['prompt', 'path'],
};

export const imageServerToolDefinitions: IAgentServerToolDefinition[] = [
	{
		name: ImageServerToolName.GenerateImage,
		title: 'Generate Image',
		description: 'Generate one PNG image with Amazon Bedrock and save it in the working directory. Each call is charged to the user\'s API budget, so call it once per image the user asked for and do not retry a failed call with the same arguments. If the tool reports a sign-in, budget or availability problem, tell the user and stop instead of drawing the picture with code. Draw diagrams and charts with code instead of this tool.',
		inputSchema: generateImageInputSchema,
		annotations: { readOnlyHint: false },
		enabledForEphemeralSessions: false,
	},
];

export function createImageServerToolGroup(accessor?: IImageServerToolAccessor): IServerToolGroup {
	return {
		definitions: imageServerToolDefinitions,
		isEnabled(toolName: string): boolean {
			return toolName === ImageServerToolName.GenerateImage && accessor?.isEnabled() === true;
		},
		isEnabledForSession(): boolean {
			return true;
		},
		getDisplay(toolName, args, result): IServerToolDisplay | undefined {
			if (toolName !== ImageServerToolName.GenerateImage) {
				return undefined;
			}
			const path = (args as { path?: unknown } | undefined)?.path;
			const label = typeof path === 'string' && path.trim() ? path.trim() : undefined;
			const target = label ? ` ${label}` : '';
			// A link to the saved file, so the user opens the image from the step instead of searching the tree.
			const file = result?.success !== false ? readSavedFile(result?.text) : undefined;
			return {
				displayName: localize('agentHost.image.displayName', "Generate Image"),
				invocationMessage: localize('agentHost.image.invocation', "Generating image{0}", target),
				pastTenseMessage: file
					? { markdown: localize('agentHost.image.pastTenseLink', "Generated image [{0}]({1})", escapeLinkText(label ?? file.path), file.toString()) }
					: localize('agentHost.image.pastTense', "Generated image{0}", target),
			};
		},
		async execute(stateManager, context, toolName, rawArgs): Promise<string> {
			if (toolName !== ImageServerToolName.GenerateImage) {
				throw new Error(`Unknown image tool: ${toolName}`);
			}
			if (!accessor || !accessor.isEnabled()) {
				throw new Error('Image generation is unavailable.');
			}
			const request = parseImageRequest(rawArgs);
			const workingDirectory = getEffectiveWorkingDirectory(stateManager, context.sessionUri);
			if (!workingDirectory) {
				throw new Error('Open a project folder before generating an image.');
			}
			const root = URI.parse(workingDirectory).fsPath;
			const target = await imageTarget(root, request.path);
			const image = await accessor.generate(request, imageRequestKey(root, request), context.providerSessionId);
			// Once paid, save even if the turn was cancelled meanwhile; re-check the path first.
			await fs.mkdir(dirname(await imageTarget(root, request.path)), { recursive: true });
			await fs.writeFile(target, image.bytes, { flag: 'wx' });
			return formatImageResult(request, image, target);
		},
	};
}

export function parseImageRequest(rawArgs: unknown): IImageRequest {
	const args = (rawArgs ?? {}) as { prompt?: unknown; path?: unknown; kind?: unknown; aspect_ratio?: unknown };
	if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > maxPromptLength) {
		throw new Error(`Invalid generate_image input: prompt must be a non-empty string of at most ${maxPromptLength} characters.`);
	}
	if (typeof args.path !== 'string' || !args.path.trim().toLowerCase().endsWith('.png')) {
		throw new Error('Invalid generate_image input: path must be a relative path ending in .png.');
	}
	const kind = args.kind ?? 'simple';
	if (kind !== 'simple' && kind !== 'text') {
		throw new Error('Invalid generate_image input: kind must be simple or text.');
	}
	const aspectRatio = args.aspect_ratio ?? defaultAspectRatio;
	if (typeof aspectRatio !== 'string' || !(aspectRatios as readonly string[]).includes(aspectRatio)) {
		throw new Error(`Invalid generate_image input: aspect_ratio must be one of ${aspectRatios.join(', ')}.`);
	}
	return { prompt: args.prompt.trim(), path: args.path.trim(), kind, aspectRatio };
}

/** The same request in the same project reuses the paid result instead of charging again. */
export function imageRequestKey(root: string, request: IImageRequest): string {
	return createHash('sha256').update(JSON.stringify([root, request.path, request.prompt, imageModels[request.kind].id, request.aspectRatio])).digest('hex');
}

/** Resolves a new PNG path that stays inside {@link root}, following existing links, and refuses to overwrite. */
export async function imageTarget(root: string, path: string): Promise<string> {
	if (isAbsolute(path)) {
		throw new Error('Choose a relative PNG path inside the project.');
	}
	const realRoot = await fs.realpath(root);
	const contained = (value: string) => {
		const rel = relative(realRoot, value);
		return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
	};
	const target = resolve(realRoot, path);
	if (!contained(target) || target === realRoot) {
		throw new Error('The image must stay inside the project.');
	}
	// Check the nearest existing ancestor, so a junction or symlink cannot lead outside the project.
	let ancestor = dirname(target);
	while (true) {
		try {
			if (!contained(await fs.realpath(ancestor))) {
				throw new Error('The output folder points outside the project.');
			}
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
			ancestor = dirname(ancestor);
		}
	}
	try {
		await fs.lstat(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return target;
		}
		throw error;
	}
	throw new Error(`${path} already exists. Choose a new file name.`);
}

const savedFilePrefix = 'File: ';

export function formatImageResult(request: IImageRequest, image: IGeneratedImage, file: string): string {
	const model = imageModels[request.kind];
	const cost = image.costMicros === null ? `about $${model.priceUsd}` : `$${(image.costMicros / 1_000_000).toFixed(2)}`;
	return `Saved ${request.path} (${request.aspectRatio}, ${model.label}). Charged ${cost} to the user's API budget.\n${savedFilePrefix}${URI.file(file).toString()}`;
}

/** The saved image's file URI from a tool result, if the result came from {@link formatImageResult}. */
function readSavedFile(text: string | undefined): URI | undefined {
	const line = text?.split('\n').find(value => value.startsWith(savedFilePrefix));
	if (!line) {
		return undefined;
	}
	const uri = URI.parse(line.slice(savedFilePrefix.length).trim());
	return uri.scheme === 'file' ? uri : undefined;
}

function escapeLinkText(value: string): string {
	return value.replace(/[\\[\]]/g, match => `\\${match}`);
}

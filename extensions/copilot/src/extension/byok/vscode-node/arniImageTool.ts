/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { IFetcherService, Response } from '../../../platform/networking/common/fetcherService';

export const ARNI_IMAGE_TOOL = 'arni_generate_image';

/** Local mirror of arni-backend imageModels — keep ids/prices in sync with GET /api/images/generations. */
export const ARNI_IMAGE_MODELS = [
	{
		id: 'stability.stable-image-core-v1:1',
		modelName: 'Stable Image Core',
		purpose: 'simple',
		costMicros: 40_000,
		usdLabel: '$0.04',
	},
	{
		id: 'stability.sd3-5-large-v1:0',
		modelName: 'Stable Diffusion 3.5 Large',
		purpose: 'text',
		costMicros: 80_000,
		usdLabel: '$0.08',
	},
] as const;

export type ArniImageModelId = (typeof ARNI_IMAGE_MODELS)[number]['id'];
export const ARNI_IMAGE_DEFAULT_MODEL: ArniImageModelId = ARNI_IMAGE_MODELS[0].id;

export interface ArniImageInput {
	prompt: string;
	savePath: string;
	aspectRatio?: string;
	/** Bedrock image model id; omit to use Stable Image Core. */
	model?: string;
}
export interface ArniImageAuth { apiBase: string; token: string }

export function resolveImageModel(model?: string) {
	const id = model?.trim() || ARNI_IMAGE_DEFAULT_MODEL;
	const card = ARNI_IMAGE_MODELS.find(row => row.id === id);
	if (!card) {
		throw new Error(vscode.l10n.t('Unknown image model. Use Stable Image Core for simple art or Stable Diffusion 3.5 Large when readable text is required.'));
	}
	return card;
}

function usdFromMicros(costMicros: number) {
	return `$${(costMicros / 1_000_000).toFixed(2)}`;
}

/** Prevent generated assets from replacing existing files or escaping a local workspace. */
export async function imageTarget(workspacePath: string, savePath: string) {
	if (!savePath || path.isAbsolute(savePath) || !savePath.toLowerCase().endsWith('.png')) {
		throw new Error(vscode.l10n.t('Choose a relative PNG path inside the project.'));
	}
	const root = await fs.realpath(workspacePath);
	const target = path.resolve(root, savePath);
	const contained = (value: string) => { const relative = path.relative(root, value); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
	if (!contained(target)) { throw new Error(vscode.l10n.t('The image must stay inside the project.')); }
	// Resolve every existing ancestor before creating directories, including junctions on Windows.
	let ancestor = path.dirname(target);
	while (true) {
		try { if (!contained(await fs.realpath(ancestor))) { throw new Error(vscode.l10n.t('The output directory points outside the project.')); } break; }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } ancestor = path.dirname(ancestor); }
	}
	try { await fs.lstat(target); throw new Error(vscode.l10n.t('This file already exists. Choose a new image path.')); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
	return target;
}

export function imageRequestKey(workspacePath: string, input: ArniImageInput) {
	const model = resolveImageModel(input.model).id;
	return createHash('sha256').update(JSON.stringify([workspacePath, input.savePath, input.prompt.trim(), input.aspectRatio || '16:9', model])).digest('hex');
}

async function readImage(response: Response) {
	const chunks: Uint8Array[] = []; let size = 0;
	for await (const chunk of response.body) {
		size += chunk.byteLength;
		if (size > 3_000_000) { response.body.destroy(); throw new Error(vscode.l10n.t('The generated image is too large.')); }
		chunks.push(chunk);
	}
	const bytes = Buffer.concat(chunks);
	if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) { throw new Error(vscode.l10n.t('The backend returned an invalid PNG.')); }
	return bytes;
}

export class ArniImageTool implements vscode.LanguageModelTool<ArniImageInput> {
	constructor(private readonly fetcher: IFetcherService, private readonly authorize: () => Promise<ArniImageAuth>) { }

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ArniImageInput>) {
		const card = resolveImageModel(options.input.model);
		return {
			invocationMessage: vscode.l10n.t('Generating image: {0}', options.input.savePath),
			confirmationMessages: {
				title: vscode.l10n.t('Generate an image'),
				message: new vscode.MarkdownString(vscode.l10n.t(
					'Generate one PNG with Amazon Bedrock {0} ({1} from your API budget) and save it as {2}.',
					card.modelName,
					card.usdLabel,
					options.input.savePath,
				)),
			},
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ArniImageInput>, token: vscode.CancellationToken) {
		const input = options.input;
		if (!input.prompt?.trim() || input.prompt.length > 10_000) { throw new Error(vscode.l10n.t('Provide an image description of up to 10,000 characters.')); }
		const card = resolveImageModel(input.model);
		const folders = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file');
		if (folders?.length !== 1) { throw new Error(vscode.l10n.t('Open one local project folder to save generated images.')); }
		const root = folders[0].uri.fsPath;
		const target = await imageTarget(root, input.savePath);
		const auth = await this.authorize();
		if (token.isCancellationRequested) { throw new vscode.CancellationError(); }
		const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': imageRequestKey(root, input) };
		// Retry recovery uses the same key and same origin; never fall back to another backend after dispatch.
		const response = await this.fetcher.fetch(`${auth.apiBase}/images/generations`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				prompt: input.prompt,
				aspect_ratio: input.aspectRatio || '16:9',
				model: card.id,
				n: 1,
			}),
			retryFallbacks: false,
			timeout: 240_000,
			callSite: 'arni-image-generation',
		});
		const result = await response.json() as { id?: string; model?: string; costMicros?: number | null; error?: { message?: string } };
		if (!response.ok || !result.id || !/^[a-zA-Z0-9-]+$/.test(result.id)) { throw new Error(result.error?.message || vscode.l10n.t('Image generation failed. Check API usage before retrying.')); }
		const billed = ARNI_IMAGE_MODELS.find(row => row.id === (result.model || card.id)) || card;
		const priceLabel = typeof result.costMicros === 'number' ? usdFromMicros(result.costMicros) : billed.usdLabel;
		const artifact = await this.fetcher.fetch(`${auth.apiBase}/images/${result.id}`, { method: 'GET', headers: { Authorization: headers.Authorization }, callSite: 'arni-image-download' });
		if (!artifact.ok) { throw new Error(vscode.l10n.t('Image download failed. Retry with the same description and path to recover it without a second charge.')); }
		const bytes = await readImage(artifact);
		// Once dispatched, finish saving even if chat was cancelled: the image may already be paid for.
		await fs.mkdir(path.dirname(target), { recursive: true });
		await imageTarget(root, input.savePath);
		await fs.writeFile(target, bytes, { flag: 'wx' });
		try { await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target)); } catch { /* Artifact remains usable without a preview editor. */ }
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(vscode.l10n.t('Generated PNG saved at {0}. Model: {1}; price: {2}. Use this project asset in the page.', target, billed.modelName, priceLabel)),
			...(bytes.length <= 2_500_000 ? [vscode.LanguageModelDataPart.image(bytes, 'image/png')] : []),
		]);
	}
}

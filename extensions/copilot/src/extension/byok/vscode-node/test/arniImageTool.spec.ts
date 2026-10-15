/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ root: '', open: vi.fn() }));
vi.mock('vscode', () => ({
	l10n: { t: (text: string, ...args: unknown[]) => text.replace(/\{(\d+)\}/g, (_, index) => String(args[index])) },
	workspace: { get workspaceFolders() { return [{ uri: { scheme: 'file', fsPath: api.root } }]; } },
	commands: { executeCommand: api.open }, Uri: { file: (value: string) => value },
	LanguageModelTextPart: class { constructor(public value: string) { } },
	LanguageModelToolResult: class { constructor(public content: unknown[]) { } },
	LanguageModelDataPart: { image: (data: Uint8Array, mimeType: string) => ({ data, mimeType }) },
	CancellationError: class extends Error { }, MarkdownString: class { constructor(public value: string) { } },
}));
import { ArniImageTool, imageRequestKey, imageTarget } from '../arniImageTool';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACLSURBVHhe7dAxAQAgEIDAD2slY34G3akAwy2MzLn7zIbBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYfCkwUrO2iye6AAAAAElFTkSuQmCC', 'base64');
describe('Arni generated image tool', () => {
	let temporary: string;
	beforeEach(async () => { temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'arni-image-tool-')); api.root = path.join(temporary, 'project'); await fs.mkdir(api.root); api.open.mockReset(); });
	afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
	it('blocks escaping paths, junctions and overwrites before billing', async () => {
		await expect(imageTarget(api.root, '../outside.png')).rejects.toThrow();
		await expect(imageTarget(api.root, path.join(temporary, 'absolute.png'))).rejects.toThrow();
		await fs.writeFile(path.join(api.root, 'existing.png'), 'keep');
		await expect(imageTarget(api.root, 'existing.png')).rejects.toThrow();
		const outside = path.join(temporary, 'outside'); await fs.mkdir(outside);
		await fs.symlink(outside, path.join(api.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
		await expect(imageTarget(api.root, 'linked/asset.png')).rejects.toThrow();
		expect(await fs.readFile(path.join(api.root, 'existing.png'), 'utf8')).toBe('keep');
	});
	it('saves a PNG, previews it and exposes it to the vision model using signed-in auth', async () => {
		const calls: Array<{ url: string; options: any }> = [];
		const fetcher = { fetch: vi.fn(async (url: string, options: any) => { calls.push({ url, options }); return options.method === 'POST'
			? { ok: true, json: async () => ({ id: 'image-123' }) }
			: { ok: true, body: (async function* () { yield png; })() }; }) };
		const tool = new ArniImageTool(fetcher as any, async () => ({ apiBase: 'https://backend.invalid/api', token: 'test-only' }));
		const input = { prompt: 'A hero illustration', savePath: 'public/generated/hero.png' };
		const result = await tool.invoke({ input } as any, { isCancellationRequested: false } as any);
		expect(await fs.readFile(path.join(api.root, input.savePath))).toEqual(png);
		expect(api.open).toHaveBeenCalledWith('vscode.open', path.join(api.root, input.savePath));
		expect(calls[0].options.headers.Authorization).toBe('Bearer test-only');
		expect(calls[0].options.retryFallbacks).toBe(false);
		expect(calls[0].options.headers['Idempotency-Key']).toBe(imageRequestKey(api.root, input));
		expect(result.content).toHaveLength(2);
		expect((result.content[1] as any).mimeType).toBe('image/png');
		await expect(tool.invoke({ input } as any, { isCancellationRequested: false } as any)).rejects.toThrow();
		expect(fetcher.fetch).toHaveBeenCalledTimes(2);
	});
	it('recovers a failed download using the original key and never changes origin', async () => {
		let failed = true; const keys: string[] = [];
		const fetcher = { fetch: vi.fn(async (url: string, options: any) => {
			expect(url.startsWith('https://backend.invalid/api/')).toBe(true);
			if (options.method === 'POST') { keys.push(options.headers['Idempotency-Key']); return { ok: true, json: async () => ({ id: 'image-123' }) }; }
			if (failed) { failed = false; return { ok: false }; }
			return { ok: true, body: (async function* () { yield png; })() };
		}) };
		const tool = new ArniImageTool(fetcher as any, async () => ({ apiBase: 'https://backend.invalid/api', token: 'test-only' }));
		const input = { prompt: 'A hero illustration', savePath: 'hero.png' };
		await expect(tool.invoke({ input } as any, { isCancellationRequested: false } as any)).rejects.toThrow(/download failed/i);
		await tool.invoke({ input } as any, { isCancellationRequested: false } as any);
		expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
	});
	it('does not dispatch cancelled requests or expose API errors as images', async () => {
		const fetcher = { fetch: vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'Budget required' } }) })) };
		const tool = new ArniImageTool(fetcher as any, async () => ({ apiBase: 'https://backend.invalid/api', token: 'test-only' }));
		const input = { prompt: 'A hero illustration', savePath: 'hero.png' };
		await expect(tool.invoke({ input } as any, { isCancellationRequested: true } as any)).rejects.toThrow();
		expect(fetcher.fetch).not.toHaveBeenCalled();
		await expect(tool.invoke({ input } as any, { isCancellationRequested: false } as any)).rejects.toThrow('Budget required');
		await expect(fs.stat(path.join(api.root, input.savePath))).rejects.toThrow();
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IArniLibraryFile {
	readonly path: string;
	readonly sha256: string;
	readonly text: string;
}

export interface IArniSkillLibrary {
	readonly schemaVersion: 1;
	readonly revision: string;
	readonly files: readonly IArniLibraryFile[];
}

export const ARNI_LIBRARY_MAX_BYTES = 2 * 1024 * 1024;
export const ARNI_LIBRARY_SKILLS = ['greenscreen-preview', 'media-toolkit', 'video-trim', 'video-audio', 'video-screencast', 'video-subtitles', 'video-inserts', 'video-reframe', 'video-story-edit', 'video-export-check', 'content-editor', 'docx-fill'] as const;
export const ARNI_LIBRARY_AGENTS = ['video-editor.agent.md', 'content-editor.agent.md'] as const;

export async function arniLibraryHash(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Validate untrusted server/cache data before deriving any filesystem path. */
export async function parseArniSkillLibrary(text: string): Promise<IArniSkillLibrary> {
	if (new TextEncoder().encode(text).byteLength > ARNI_LIBRARY_MAX_BYTES) {
		throw new Error('Skill library exceeds the size limit');
	}
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== 'object') {
		throw new Error('Invalid skill library');
	}
	const library = value as Partial<IArniSkillLibrary>;
	if (library.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(library.revision ?? '') || !Array.isArray(library.files) || !library.files.length || library.files.length > 150) {
		throw new Error('Unsupported skill library format');
	}
	const seen = new Set<string>();
	const files: IArniLibraryFile[] = [];
	const entries: readonly IArniLibraryFile[] = library.files;
	for (const file of entries) {
		if (!file || typeof file.path !== 'string' || typeof file.text !== 'string' || typeof file.sha256 !== 'string') {
			throw new Error('Invalid library file');
		}
		const validPath = /^(?:skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:SKILL\.md|(?:scripts|references)\/[a-zA-Z0-9_-]+\.(?:py|md))|agents\/[a-z0-9]+(?:-[a-z0-9]+)*\.agent\.md)$/.test(file.path);
		if (!validPath || file.path.split('/').some(part => /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) || seen.has(file.path.toLowerCase())) {
			throw new Error('Unsafe or duplicate library path');
		}
		if (file.text.includes('\0') || new TextEncoder().encode(file.text).byteLength > 256 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256) || await arniLibraryHash(file.text) !== file.sha256) {
			throw new Error('Library file integrity check failed');
		}
		seen.add(file.path.toLowerCase());
		files.push({ path: file.path, sha256: file.sha256, text: file.text });
	}
	files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	if (!files.some(file => file.path.endsWith('/SKILL.md')) || await arniLibraryHash(JSON.stringify(files.map(file => [file.path, file.sha256]))) !== library.revision) {
		throw new Error('Library revision integrity check failed');
	}
	return { schemaVersion: 1, revision: library.revision!, files };
}

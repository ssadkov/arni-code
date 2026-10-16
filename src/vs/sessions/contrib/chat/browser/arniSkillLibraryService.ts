/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { FileAccess, Schemas } from '../../../../base/common/network.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { ARNI_LIBRARY_AGENTS, ARNI_LIBRARY_MAX_BYTES, ARNI_LIBRARY_SKILLS, arniLibraryHash, IArniSkillLibrary, parseArniSkillLibrary } from '../common/arniSkillLibrary.js';

export const IArniSkillLibraryService = createDecorator<IArniSkillLibraryService>('arniSkillLibraryService');
export interface IArniInstalledLibrary {
	readonly root: URI;
	readonly library: IArniSkillLibrary;
}
export interface IArniSkillLibraryService {
	readonly _serviceBrand: undefined;
	getCurrent(): Promise<IArniInstalledLibrary | undefined>;
	update(token: CancellationToken): Promise<{ revision: string; changed: boolean }>;
	copyForEditing(destination: URI): Promise<void>;
}

const ENDPOINTS = ['https://api.arnion.ru/api/skills/library', 'https://arni-backend.vercel.app/api/skills/library'];
const POINTER_PATTERN = /^[a-f0-9]{64}-[a-f0-9-]{36}$/;

/** Version directories remain immutable so running chats keep their original helpers. */
export class ArniSkillLibraryService implements IArniSkillLibraryService {
	declare readonly _serviceBrand: undefined;
	private readonly home: URI;
	private current: Promise<IArniInstalledLibrary | undefined> | undefined;
	private updating: Promise<{ revision: string; changed: boolean }> | undefined;

	constructor(
		@IFileService private readonly files: IFileService,
		@IRequestService private readonly requests: IRequestService,
		@IEnvironmentService environment: IEnvironmentService,
		@ILogService private readonly log: ILogService,
	) {
		this.home = joinPath(environment.cacheHome, 'arniSkillLibrary');
	}

	getCurrent(): Promise<IArniInstalledLibrary | undefined> {
		return this.current ??= this.readCurrent();
	}

	private async readCurrent(): Promise<IArniInstalledLibrary | undefined> {
		try {
			const pointer: unknown = JSON.parse((await this.files.readFile(joinPath(this.home, 'active.json'))).value.toString());
			if (!pointer || typeof pointer !== 'object' || !('directory' in pointer) || typeof pointer.directory !== 'string' || !POINTER_PATTERN.test(pointer.directory)) {
				throw new Error('Invalid library pointer');
			}
			const root = joinPath(this.home, pointer.directory);
			const library = await parseArniSkillLibrary((await this.files.readFile(joinPath(root, 'library.json'))).value.toString());
			if (!pointer.directory.startsWith(library.revision + '-')) {
				throw new Error('Library pointer revision mismatch');
			}
			for (const file of library.files) {
				const text = (await this.files.readFile(joinPath(root, file.path))).value.toString();
				if (await arniLibraryHash(text) !== file.sha256) {
					throw new Error('Cached library changed');
				}
			}
			return { root, library };
		} catch (error) {
			this.log.debug('[ArniSkillLibrary] Using bundled library:', error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}

	update(token: CancellationToken): Promise<{ revision: string; changed: boolean }> {
		if (!this.updating) {
			this.updating = this.download(token).finally(() => { this.updating = undefined; });
		}
		return this.updating;
	}

	private async download(token: CancellationToken): Promise<{ revision: string; changed: boolean }> {
		let library: IArniSkillLibrary | undefined;
		let failure: unknown;
		for (const url of ENDPOINTS) {
			try {
				if (token.isCancellationRequested) { throw new CancellationError(); }
				const response = await this.requests.request({ url, type: 'GET', timeout: 15_000, callSite: 'arni.skillLibrary.update' }, token);
				if (response.res.statusCode !== 200 || Number(response.res.headers['content-length'] ?? 0) > ARNI_LIBRARY_MAX_BYTES) {
					throw new Error('Skill library download failed');
				}
				library = await parseArniSkillLibrary(await asText(response) ?? '');
				break;
			} catch (error) {
				if (token.isCancellationRequested) { throw new CancellationError(); }
				failure = error;
			}
		}
		if (!library) { throw failure ?? new Error('Skill library unavailable'); }
		const previous = await this.readCurrent();
		if (previous?.library.revision === library.revision) {
			return { revision: library.revision, changed: false };
		}
		if (this.home.scheme !== Schemas.file) {
			throw new Error('Local desktop storage is required for executable skill helpers');
		}
		const directory = library.revision + '-' + generateUuid();
		const root = joinPath(this.home, directory);
		await this.files.createFolder(root);
		for (const file of library.files) {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			const target = joinPath(root, file.path);
			await this.files.createFolder(dirname(target));
			await this.files.writeFile(target, VSBuffer.fromString(file.text));
		}
		await this.files.writeFile(joinPath(root, 'library.json'), VSBuffer.fromString(JSON.stringify(library)));
		if (token.isCancellationRequested) { throw new CancellationError(); }
		const pendingPointer = joinPath(this.home, 'active-' + generateUuid() + '.json');
		await this.files.writeFile(pendingPointer, VSBuffer.fromString(JSON.stringify({ directory })));
		await this.files.move(pendingPointer, joinPath(this.home, 'active.json'), true);
		// Do not change this.current: already discovered prompts retain their version until reload.
		return { revision: library.revision, changed: true };
	}

	async copyForEditing(destination: URI): Promise<void> {
		if (destination.scheme !== Schemas.file) {
			throw new Error('Choose a local project folder');
		}
		for (const parent of [joinPath(destination, '.github'), joinPath(destination, '.github', 'skills'), joinPath(destination, '.github', 'agents')]) {
			if (await this.files.exists(parent) && (await this.files.resolve(parent)).isSymbolicLink) {
				throw new Error('Choose a project without linked customization directories');
			}
		}
		const current = await this.getCurrent();
		const entries: { destination: URI; content: VSBuffer }[] = [];
		if (current) {
			for (const file of current.library.files) {
				entries.push({ destination: joinPath(destination, '.github', file.path), content: VSBuffer.fromString(file.text) });
			}
		} else {
			// Copy only this profession pack, not unrelated development skills.
			const add = async (source: URI, target: URI) => entries.push({ destination: target, content: (await this.files.readFile(source)).value });
			for (const name of ARNI_LIBRARY_SKILLS) {
				const source = joinPath(FileAccess.asFileUri('vs/sessions/skills'), name);
				const target = joinPath(destination, '.github', 'skills', name);
				await add(joinPath(source, 'SKILL.md'), joinPath(target, 'SKILL.md'));
				for (const folder of ['scripts', 'references']) {
					const directory = joinPath(source, folder);
					if (!await this.files.exists(directory)) { continue; }
					for (const child of (await this.files.resolve(directory)).children ?? []) {
						if (!child.isDirectory && /^[a-zA-Z0-9_-]+\.(py|md)$/.test(child.name)) {
							await add(child.resource, joinPath(target, folder, child.name));
						}
					}
				}
			}
			for (const name of ARNI_LIBRARY_AGENTS) {
				await add(joinPath(FileAccess.asFileUri('vs/sessions/agents'), name), joinPath(destination, '.github', 'agents', name));
			}
		}
		// Check every target before the first write. Never overwrite customized workspace skills.
		const collisionRoots = new Map<string, URI>();
		for (const entry of entries) {
			const parts = entry.destination.path.slice(joinPath(destination, '.github').path.length + 1).split('/');
			const target = joinPath(destination, '.github', parts[0], parts[1]);
			collisionRoots.set(target.toString(), target);
		}
		for (const target of collisionRoots.values()) {
			if (await this.files.exists(target)) {
				throw new Error('A workspace copy already exists: ' + target.toString());
			}
		}
		for (const entry of entries) {
			await this.files.createFolder(dirname(entry.destination));
			await this.files.createFile(entry.destination, entry.content, { overwrite: false });
		}
	}
}

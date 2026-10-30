/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { FileAccess } from '../../../../base/common/network.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { SKILL_FILENAME } from '../../../../workbench/contrib/chat/common/promptSyntax/config/promptFileLocations.js';
import { PromptsType } from '../../../../workbench/contrib/chat/common/promptSyntax/promptTypes.js';
import { IAgentSkill, IBuiltinPromptPath, ICustomAgent, PromptsStorage } from '../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';
import { PromptsService } from '../../../../workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IAgentPluginService } from '../../../../workbench/contrib/chat/common/plugins/agentPluginService.js';
import { IPathService } from '../../../../workbench/services/path/common/pathService.js';
import { IUserDataProfileService } from '../../../../workbench/services/userDataProfile/common/userDataProfile.js';
import { IArniSkillLibraryService } from './arniSkillLibraryService.js';
import { PromptHeader } from '../../../../workbench/contrib/chat/common/promptSyntax/promptFileParser.js';

/** An older managed catalog must not replace newer bundled workflow instructions after an app update. */
export function shouldReplaceBuiltinPrompt(current: string | undefined, candidate: string | undefined): boolean {
	const parts = (version: string | undefined) => /^\d+\.\d+\.\d+$/.test(version ?? '') ? version!.split('.').map(Number) : [0, 0, 0];
	const a = parts(current), b = parts(candidate);
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) { return b[i] > a[i]; }
	}
	return true;
}

function builtinPromptVersion(header: PromptHeader | undefined): string | undefined {
	const metadata = header?.getAttribute('metadata')?.value;
	if (metadata?.type !== 'map') { return undefined; }
	const version = metadata.properties.find(property => property.key.value === 'version')?.value;
	return version?.type === 'scalar' ? version.value : undefined;
}

/** URI root for built-in skills bundled with the Agents app. */
export const BUILTIN_SKILLS_URI = FileAccess.asFileUri('vs/sessions/skills');

/**
 * Sessions-specific PromptsService that additionally discovers built-in skills
 * bundled at `vs/sessions/skills/{folder}/SKILL.md`.
 *
 * Built-in skills are contributed via the single {@link getBuiltinPromptFiles}
 * override, so the base service merges them into `findAgentSkills()`,
 * `listPromptFiles(skill)` and
 * `listPromptFilesForStorage(skill, PromptsStorage.builtIn)` and applies its own
 * parsing, sanitization and duplicate-name precedence. Built-ins have the lowest
 * skill priority, so a user/workspace skill with the same folder name wins.
 */
export class AgenticPromptsService extends PromptsService {
	constructor(
		@ILogService logger: ILogService,
		@ILabelService labelService: ILabelService,
		@IModelService modelService: IModelService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IUserDataProfileService userDataService: IUserDataProfileService,
		@IConfigurationService configurationService: IConfigurationService,
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@IPathService pathService: IPathService,
		@IAgentPluginService agentPluginService: IAgentPluginService,
		@IWorkspaceTrustManagementService workspaceTrustService: IWorkspaceTrustManagementService,
		@IArniSkillLibraryService private readonly library: IArniSkillLibraryService,
	) {
		super(logger, labelService, modelService, instantiationService, userDataService, configurationService, fileService,
			storageService, telemetryService, workspaceService, pathService, agentPluginService, workspaceTrustService);
	}

	private _builtinSkillsCache: Promise<readonly IAgentSkill[]> | undefined;

	override async getCustomAgents(token: CancellationToken): Promise<readonly ICustomAgent[]> {
		const agents = await super.getCustomAgents(token);
		const customized = new Set(agents.filter(agent => agent.source.storage !== PromptsStorage.builtIn).map(agent => agent.name));
		return agents.filter(agent => agent.source.storage !== PromptsStorage.builtIn || !customized.has(agent.name));
	}

	private async getBuiltinSkills(): Promise<readonly IAgentSkill[]> {
		if (!this._builtinSkillsCache) {
			this._builtinSkillsCache = this.discoverBuiltinSkills();
		}
		return this._builtinSkillsCache;
	}

	private async discoverBuiltinSkills(): Promise<readonly IAgentSkill[]> {
		try {
			const managed = await this.library.getCurrent();
			const roots = [BUILTIN_SKILLS_URI, ...(managed ? [joinPath(managed.root, 'skills')] : [])];
			const skills = new Map<string, IAgentSkill>();
			const versions = new Map<string, string | undefined>();
			for (const root of roots) {
				if (!await this.fileService.exists(root)) { continue; }
				const stat = await this.fileService.resolve(root);
				for (const child of stat.children ?? []) {
					if (!child.isDirectory) {
						continue;
					}
					const skillFileUri = joinPath(child.resource, SKILL_FILENAME);
					try {
						const parsed = await this.parseNew(skillFileUri, CancellationToken.None);
						const rawName = parsed.header?.name;
						const rawDescription = parsed.header?.description;
						if (!rawName || !rawDescription) { continue; }
						const name = sanitizeSkillText(rawName, 64);
						if (name !== basename(child.resource)) { continue; }
						const version = builtinPromptVersion(parsed.header);
						if (skills.has(name) && !shouldReplaceBuiltinPrompt(versions.get(name), version)) { continue; }
						versions.set(name, version);
						skills.set(name, { uri: skillFileUri, storage: PromptsStorage.builtIn, name,
							description: sanitizeSkillText(rawDescription, 1024),
							disableModelInvocation: parsed.header?.disableModelInvocation === true,
							userInvocable: parsed.header?.userInvocable !== false });
					} catch (e) {
						this.logger.warn(`[AgenticPromptsService] Failed to parse built-in skill: ${skillFileUri}`, e instanceof Error ? e.message : String(e));
					}
				}
			}
			return [...skills.values()];
		} catch {
			return [];
		}
	}

	private async getBuiltinSkillPaths(): Promise<readonly IBuiltinPromptPath[]> {
		const skills = await this.getBuiltinSkills();
		return skills.map(s => ({
			uri: s.uri,
			storage: PromptsStorage.builtIn,
			type: PromptsType.skill,
			name: s.name,
			description: s.description,
		}));
	}

	/**
	 * Contributes the built-in skills bundled with the Agents app. The base
	 * {@link PromptsService} merges these into skill discovery
	 * (`findAgentSkills()`), `listPromptFiles(skill)` and
	 * `listPromptFilesForStorage(skill, PromptsStorage.builtIn)`, applying its
	 * own parsing, sanitization and duplicate-name precedence (built-ins have
	 * the lowest priority, so user/workspace skills of the same name win).
	 */
	protected override async getBuiltinPromptFiles(type: PromptsType, token: CancellationToken): Promise<readonly IBuiltinPromptPath[]> {
		if (type === PromptsType.agent) {
			// Harness synchronization lists each storage separately, bypassing getCustomAgents.
			// Suppress overridden built-ins here too so the picker and SDK receive one profile.
			const customized = new Set<string>();
			const overrides = await Promise.all([PromptsStorage.local, PromptsStorage.user, PromptsStorage.plugin, PromptsStorage.extension]
				.map(storage => this.listPromptFilesForStorage(type, storage, token)));
			for (const file of overrides.flat()) {
				try {
					const parsed = await this.parseNew(file.uri, token);
					customized.add(sanitizeSkillText(parsed.header?.name ?? file.name ?? basename(file.uri).replace(/\.agent\.md$/, ''), 64));
				} catch (error) {
					this.logger.debug('[AgenticPromptsService] Could not read profession override', error);
				}
			}
			const managed = await this.library.getCurrent();
			const roots = [FileAccess.asFileUri('vs/sessions/agents'), ...(managed ? [joinPath(managed.root, 'agents')] : [])];
			const agents = new Map<string, IBuiltinPromptPath>();
			const versions = new Map<string, string | undefined>();
			for (const root of roots) {
				if (!await this.fileService.exists(root)) { continue; }
				const stat = await this.fileService.resolve(root);
				for (const child of stat.children ?? []) {
					if (child.isDirectory || !child.name.endsWith('.agent.md')) { continue; }
					try {
						const parsed = await this.parseNew(child.resource, token);
						if (parsed.header?.name && parsed.header.description) {
							const version = builtinPromptVersion(parsed.header);
							if (agents.has(child.name) && !shouldReplaceBuiltinPrompt(versions.get(child.name), version)) { continue; }
							versions.set(child.name, version);
							agents.set(child.name, { uri: child.resource, storage: PromptsStorage.builtIn, type,
								name: sanitizeSkillText(parsed.header.name, 64), description: sanitizeSkillText(parsed.header.description, 1024) });
						}
					} catch (error) {
						this.logger.warn('[AgenticPromptsService] Could not read profession profile', error);
					}
				}
			}
			return [...agents.values()].filter(agent => !customized.has(agent.name ?? ''));
		}
		if (type !== PromptsType.skill) {
			return [];
		}
		return this.getBuiltinSkillPaths();
	}
}

/**
 * Strips XML tags and truncates to the given max length.
 * Matches the sanitization applied by PromptsService for other skill sources.
 */
function sanitizeSkillText(text: string, maxLength: number): string {
	const sanitized = text.replace(/<[^>]+>/g, '');
	return sanitized.length > maxLength ? sanitized.substring(0, maxLength) : sanitized;
}

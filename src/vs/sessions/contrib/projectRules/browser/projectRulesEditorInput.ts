/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { isEqual, basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { EditorInputCapabilities, GroupIdentifier, ISaveOptions, IUntypedEditorInput } from '../../../../workbench/common/editor.js';
import { EditorInput } from '../../../../workbench/common/editor/editorInput.js';
import { ITextFileEditorModel, ITextFileService, TextFileEditorModelState } from '../../../../workbench/services/textfile/common/textfiles.js';

/** Project rules share the ordinary file working copy, including backups and save conflicts. */
export class ProjectRulesEditorInput extends EditorInput {

	static readonly ID = 'arni.projectRules.input';

	override readonly resource: URI;
	private model: ITextFileEditorModel | undefined;
	private resolving: Promise<ITextFileEditorModel> | undefined;

	constructor(
		readonly projectRoot: URI,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@ITextModelService private readonly textModelService: ITextModelService,
	) {
		super();
		this.resource = URI.joinPath(projectRoot, 'AGENTS.md');
	}

	override get typeId(): string { return ProjectRulesEditorInput.ID; }
	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Singleton | (this.model?.isReadonly() ? EditorInputCapabilities.Readonly : 0);
	}
	override getName(): string { return localize('arni.projectRules.title', "Правила проекта"); }
	override getDescription(): string { return basename(this.projectRoot); }
	override getIcon() { return Codicon.book; }
	override isDirty(): boolean { return this.model?.isDirty() ?? false; }
	override isSaving(): boolean { return this.model?.hasState(TextFileEditorModelState.PENDING_SAVE) ?? false; }

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof ProjectRulesEditorInput && isEqual(this.resource, other.resource);
	}

	override async resolve(): Promise<ITextFileEditorModel> {
		if (!this.resolving) {
			this.resolving = this.resolveModel().catch(error => {
				this.resolving = undefined;
				throw error;
			});
		}
		return this.resolving;
	}

	private async resolveModel(): Promise<ITextFileEditorModel> {
		// Opening the editor creates an empty rules file only when none exists.
		// createFile refuses to overwrite a file created concurrently.
		if (!await this.fileService.exists(this.resource)) {
			try {
				await this.fileService.createFile(this.resource);
			} catch (error) {
				if (!await this.fileService.exists(this.resource)) {
					throw error;
				}
			}
		}
		const model = await this.textFileService.files.resolve(this.resource);
		this._register(await this.textModelService.createModelReference(this.resource));
		this.model = model;
		this._register(model.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
		this._register(model.onDidChangeReadonly(() => this._onDidChangeCapabilities.fire()));
		this._onDidChangeDirty.fire();
		return model;
	}

	override async save(_group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | undefined> {
		const model = await this.resolve();
		return await model.save(options) ? this : undefined;
	}

	override async revert(): Promise<void> {
		await this.model?.revert();
	}
}

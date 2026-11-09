/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/projectRules.css';
import { $, append, Dimension } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../workbench/browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../workbench/common/editor.js';
import { IEditorGroup } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { ProjectRulesEditorInput } from './projectRulesEditorInput.js';

/** A focused editor for the active project's AGENTS.md. */
export class ProjectRulesEditor extends EditorPane {

	static readonly ID = 'arni.projectRules.editor';
	private container!: HTMLElement;
	private projectLabel!: HTMLElement;
	private status!: HTMLElement;
	private editorContainer!: HTMLElement;
	private editor!: CodeEditorWidget;
	private saveButton!: Button;
	private readonly inputDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super(ProjectRulesEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('.arni-project-rules'));
		const header = append(this.container, $('.project-rules-header'));
		append(header, $('h1')).textContent = localize('arni.projectRules.title', "Правила проекта");
		this.projectLabel = append(header, $('p.project-rules-project'));
		append(header, $('p.project-rules-description')).textContent = localize('arni.projectRules.description', "Задайте общие правила для задач в этом проекте: язык, стиль, формат изображений и другие пожелания.");
		const label = append(header, $('p.project-rules-label'));
		label.textContent = localize('arni.projectRules.example', "Например: «По умолчанию создавай вертикальные изображения 9:16. Пиши на русском языке».");
		this.editorContainer = append(this.container, $('.project-rules-content'));
		this.editor = this._register(this.instantiationService.createInstance(CodeEditorWidget, this.editorContainer, {
			ariaLabel: localize('arni.projectRules.contents', "Текст правил проекта"),
			wordWrap: 'on',
			minimap: { enabled: false },
			lineNumbers: 'off',
			glyphMargin: false,
			folding: false,
			scrollBeyondLastLine: false,
			renderLineHighlight: 'none',
			overviewRulerLanes: 0,
		}, {}));
		const footer = append(this.container, $('.project-rules-footer'));
		this.saveButton = this._register(new Button(footer, { ...defaultButtonStyles }));
		this.saveButton.label = localize('arni.projectRules.save', "Сохранить");
		this.saveButton.enabled = false;
		this._register(this.saveButton.onDidClick(() => { void this.saveRules(); }));
		this.status = append(footer, $('span.project-rules-status', { role: 'status', 'aria-live': 'polite' }));
	}

	override async setInput(input: ProjectRulesEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.inputDisposables.clear();
		this.editor.setModel(null);
		this.saveButton.enabled = false;
		await super.setInput(input, options, context, token);
		this.projectLabel.textContent = this.labelService.getUriLabel(input.projectRoot);
		this.status.textContent = localize('arni.projectRules.loading', "Загружаем правила…");
		const model = await input.resolve();
		if (token.isCancellationRequested || this.input !== input || !model.isResolved()) {
			return;
		}
		this.editor.setModel(model.textEditorModel);
		const update = () => {
			this.saveButton.enabled = input.isDirty() && !model.isReadonly();
			this.status.textContent = input.isDirty()
				? localize('arni.projectRules.unsaved', "Есть несохранённые изменения")
				: localize('arni.projectRules.ready', "Правила сохранены для этого проекта.");
		};
		this.editor.updateOptions({ readOnly: !!model.isReadonly() });
		this.inputDisposables.add(model.onDidChangeDirty(update));
		this.inputDisposables.add(model.onDidSave(update));
		this.inputDisposables.add(model.onDidChangeReadonly(() => {
			this.editor.updateOptions({ readOnly: !!model.isReadonly() });
			update();
		}));
		update();
	}

	private async saveRules(): Promise<void> {
		const input = this.input;
		if (!(input instanceof ProjectRulesEditorInput)) {
			return;
		}
		this.saveButton.enabled = false;
		try {
			const saved = await input.save(this.group.id);
			if (this.input === input && !saved) {
				this.status.textContent = localize('arni.projectRules.saveFailed', "Не удалось сохранить правила. Проверьте уведомления и повторите попытку.");
			}
		} catch {
			if (this.input === input) {
				this.status.textContent = localize('arni.projectRules.saveFailed', "Не удалось сохранить правила. Проверьте уведомления и повторите попытку.");
			}
		} finally {
			if (this.input === input) {
				this.saveButton.enabled = input.isDirty();
			}
		}
	}

	override clearInput(): void {
		this.inputDisposables.clear();
		this.editor.setModel(null);
		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		this.container.style.height = `${dimension.height}px`;
		this.editor.layout(new Dimension(this.editorContainer.clientWidth, this.editorContainer.clientHeight));
	}

	override focus(): void {
		super.focus();
		this.editor.focus();
	}

	override getControl(): CodeEditorWidget {
		return this.editor;
	}
}

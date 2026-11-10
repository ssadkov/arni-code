/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/starterProjectGallery.css';
import * as dom from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { getArniAgentIdentity } from '../../../../workbench/contrib/chat/common/arniAgentIdentity.js';
import { IPathService } from '../../../../workbench/services/path/common/pathService.js';

const STARTER_PROJECT_PARENT_KEY = 'sessions.starterProjects.parentFolder';
const PROJECT_RULES_FILE_NAME = 'AGENTS.md';

/**
 * A ready idea. A `project` produces files, so it gets its own folder with an
 * AGENTS.md holding the project rules; a `task` opens a chat without a folder.
 * Either way the card only fills the composer: nothing is sent to the model
 * until the user presses send.
 */
interface IStarterIdea {
	readonly kind: 'project' | 'task';
	readonly professionId: string;
	readonly title: string;
	readonly description: string;
	readonly tooltip: string;
	readonly icon: ThemeIcon;
	/** Short text placed in the composer; the user finishes and sends it. */
	readonly prompt: string;
	/** Project only: folder name and the rules written to AGENTS.md. */
	readonly folderName?: string;
	readonly rules?: string;
}

/** Rules every self-contained web page project shares. */
function getWebPageRules(): string {
	return localize('starterProjects.rules.webPage', "- Используй HTML, CSS и JavaScript без внешних зависимостей, если в задаче не сказано иначе.\n- Не используй Python и не запускай серверы: результат должен открываться, если просто открыть index.html в браузере.\n- Если тема не указана, возьми понятный пример и явно обозначь текст, который нужно заменить.\n- Когда файлы готовы, открой index.html во встроенном браузере, проверь основное действие и вид на широком и узком экране, сохрани скриншоты.\n- Не делай циклических проверок.\n- В конце простыми словами объясни, как открыть результат и что заменить или улучшить.");
}

function getProjectRulesFile(title: string, rules: string): string {
	return localize('starterProjects.rules.file', "# Правила проекта: {0}\n\nЭти правила агент читает в каждом чате этой папки. Их можно менять: «Правила проекта» в меню сессии.\n\n{1}\n", title, rules);
}

function getStarterIdeas(): readonly IStarterIdea[] {
	const webPage = getWebPageRules();
	return [
		{
			kind: 'project',
			professionId: 'programmer',
			title: localize('starterProjects.landing.title', "Лендинг"),
			description: localize('starterProjects.landing.description', "Страница для вашей идеи"),
			tooltip: localize('starterProjects.landing.tooltip', "Адаптивная страница с первым экраном, преимуществами и кнопкой действия. Текст и оформление можно изменить позже."),
			icon: Codicon.layout,
			folderName: 'landing-page',
			rules: localize('starterProjects.landing.rules', "Адаптивный лендинг: выразительный первый экран, преимущества, примеры и кнопка действия.\n\n{0}", webPage),
			prompt: localize('starterProjects.landing.prompt', "Сделай лендинг для "),
		},
		{
			kind: 'task',
			professionId: 'researcher',
			title: localize('starterProjects.research.title', "Сравнить источники"),
			description: localize('starterProjects.research.description', "Факты, расхождения и ссылки"),
			tooltip: localize('starterProjects.research.tooltip', "Факты, расхождения и ссылки"),
			icon: Codicon.search,
			prompt: localize('starterProjects.research.prompt', "Сравни источники по теме: "),
		},
		{
			kind: 'task',
			professionId: 'data-analyst',
			title: localize('starterProjects.tables.title', "Сверить таблицы"),
			description: localize('starterProjects.tables.description', "Excel и CSV без потери дублей"),
			tooltip: localize('starterProjects.tables.tooltip', "Прикрепите две таблицы и назовите ключевую колонку."),
			icon: Codicon.table,
			prompt: localize('starterProjects.tables.prompt', "Сверь две прикреплённые таблицы. Ключевая колонка: "),
		},
		{
			kind: 'project',
			professionId: 'presentation-designer',
			title: localize('starterProjects.slides.title', "Сделать презентацию"),
			description: localize('starterProjects.slides.description', "Структура и редактируемый PPTX"),
			tooltip: localize('starterProjects.slides.tooltip', "Структура и редактируемый PPTX"),
			icon: Codicon.preview,
			folderName: 'presentation',
			rules: localize('starterProjects.slides.rules', "- Сначала уточни материал, аудиторию и цель, если их нет в задаче.\n- Подготовь план слайдов, затем редактируемый PPTX в новом файле.\n- Не выдумывай факты.\n- Проверь структуру и, если доступен рендер, внешний вид; явно сообщи, если визуальная проверка недоступна."),
			prompt: localize('starterProjects.slides.prompt', "Сделай презентацию на тему: "),
		},
		{
			kind: 'task',
			professionId: 'file-organizer',
			title: localize('starterProjects.files.title', "Разобрать файлы"),
			description: localize('starterProjects.files.description', "Сначала план, затем перемещения"),
			tooltip: localize('starterProjects.files.tooltip', "Сначала план, затем перемещения"),
			icon: Codicon.folderOpened,
			prompt: localize('starterProjects.files.prompt', "Помоги разобрать папку: "),
		},
		{
			kind: 'project',
			professionId: 'instructional-designer',
			title: localize('starterProjects.lesson.title', "Создать мини-урок"),
			description: localize('starterProjects.lesson.description', "Объяснение и проверка знаний"),
			tooltip: localize('starterProjects.lesson.tooltip', "Объяснение и проверка знаний"),
			icon: Codicon.book,
			folderName: 'mini-lesson',
			rules: localize('starterProjects.lesson.rules', "- Сначала уточни исходный материал и аудиторию, если их нет в задаче.\n- Урок — автономная HTML-страница с объяснением, вопросами и обратной связью.\n- Не добавляй факты без источника.\n- Проверь правильный и неправильный ответ, управление с клавиатуры и узкий экран."),
			prompt: localize('starterProjects.lesson.prompt', "Сделай мини-урок по теме: "),
		},
		{
			kind: 'task',
			professionId: 'sysadmin',
			title: localize('starterProjects.computer.title', "Проверить компьютер"),
			description: localize('starterProjects.computer.description', "Характеристики, место и автозагрузка"),
			tooltip: localize('starterProjects.computer.tooltip', "Характеристики, место и автозагрузка"),
			icon: Codicon.tools,
			prompt: localize('starterProjects.computer.prompt', "Проверь мой компьютер: характеристики, свободное место и автозагрузку. Ничего не удаляй и не отключай."),
		},
		{
			kind: 'task',
			professionId: 'video-editor',
			title: localize('starterProjects.video.title', "Заменить зелёный фон"),
			description: localize('starterProjects.video.description', "Пятисекундный предпросмотр"),
			tooltip: localize('starterProjects.video.tooltip', "Прикрепите видео и картинку для фона."),
			icon: Codicon.deviceCameraVideo,
			prompt: localize('starterProjects.video.prompt', "Замени зелёный фон в прикреплённом видео. Сначала покажи пятисекундный предпросмотр."),
		},
		{
			kind: 'task',
			professionId: 'secretary',
			title: localize('starterProjects.form.title', "Заполнить анкету"),
			description: localize('starterProjects.form.description', "Черновик с данными вашей карточки"),
			tooltip: localize('starterProjects.form.tooltip', "Черновик с данными вашей карточки"),
			icon: Codicon.notebook,
			prompt: localize('starterProjects.form.prompt', "Помоги заполнить анкету, не отправляя её: "),
		},
		{
			kind: 'task',
			professionId: 'content-editor',
			title: localize('starterProjects.content.title', "Подготовить публикацию"),
			description: localize('starterProjects.content.description', "Текст для вашей площадки"),
			tooltip: localize('starterProjects.content.tooltip', "Текст для вашей площадки"),
			icon: Codicon.edit,
			prompt: localize('starterProjects.content.prompt', "Подготовь публикацию для "),
		},
		{
			kind: 'project',
			professionId: 'programmer',
			title: localize('starterProjects.game.title', "Игра"),
			description: localize('starterProjects.game.description', "Браузерная «Змейка»"),
			tooltip: localize('starterProjects.game.tooltip', "Игра со счётом, управлением с клавиатуры и телефона и кнопкой перезапуска. Работает прямо в браузере."),
			icon: Codicon.game,
			folderName: 'snake-game',
			rules: localize('starterProjects.game.rules', "Браузерная игра: счёт, управление с клавиатуры и телефона, экран проигрыша и перезапуск.\n\n{0}", webPage),
			prompt: localize('starterProjects.game.prompt', "Сделай браузерную игру «Змейка»"),
		},
		{
			kind: 'project',
			professionId: 'programmer',
			title: localize('starterProjects.portfolio.title', "Портфолио"),
			description: localize('starterProjects.portfolio.description', "Личный сайт с проектами"),
			tooltip: localize('starterProjects.portfolio.tooltip', "Готовый личный сайт: информация о вас, карточки проектов и контакты. Примерные данные легко заменить."),
			icon: Codicon.account,
			folderName: 'my-portfolio',
			rules: localize('starterProjects.portfolio.rules', "Сайт-портфолио: блок «Обо мне», карточки проектов и контакты. Примерные данные явно обозначены.\n\n{0}", webPage),
			prompt: localize('starterProjects.portfolio.prompt', "Сделай сайт-портфолио для "),
		},
		{
			kind: 'project',
			professionId: 'programmer',
			title: localize('starterProjects.quiz.title', "Квиз"),
			description: localize('starterProjects.quiz.description', "Вопросы и результат"),
			tooltip: localize('starterProjects.quiz.tooltip', "Небольшая викторина с несколькими вопросами, подсчётом баллов и возможностью пройти её заново."),
			icon: Codicon.question,
			folderName: 'my-quiz',
			rules: localize('starterProjects.quiz.rules', "Браузерный квиз: понятный выбор ответов, подсчёт баллов, экран результата и повторное прохождение.\n\n{0}", webPage),
			prompt: localize('starterProjects.quiz.prompt', "Сделай квиз на тему: "),
		},
		{
			kind: 'project',
			professionId: 'programmer',
			title: localize('starterProjects.habits.title', "Трекер привычек"),
			description: localize('starterProjects.habits.description', "Отмечайте прогресс по дням"),
			tooltip: localize('starterProjects.habits.tooltip', "Добавляйте привычки и отмечайте выполненные дни. Отметки сохраняются в браузере без регистрации."),
			icon: Codicon.calendar,
			folderName: 'habit-tracker',
			rules: localize('starterProjects.habits.rules', "Трекер привычек: добавление привычек, отметки по дням и прогресс за неделю. Данные хранятся локально в браузере, без аккаунта и сервера.\n\n{0}", webPage),
			prompt: localize('starterProjects.habits.prompt', "Сделай трекер привычек"),
		},
		{
			kind: 'project',
			professionId: 'programmer',
			title: localize('starterProjects.catalog.title', "Каталог"),
			description: localize('starterProjects.catalog.description', "Карточки с поиском"),
			tooltip: localize('starterProjects.catalog.tooltip', "Небольшой каталог товаров или работ: карточки, поиск и фильтры. Оплата и аккаунт не нужны."),
			icon: Codicon.listUnordered,
			folderName: 'my-catalog',
			rules: localize('starterProjects.catalog.rules', "Адаптивный каталог: примерные карточки, поиск и фильтр по категориям. Без оплаты и аккаунтов.\n\n{0}", webPage),
			prompt: localize('starterProjects.catalog.prompt', "Сделай каталог для "),
		},
	];
}

const CUSTOM_PROJECT_FOLDER_NAME = 'my-project';
const MAX_FOLDER_NAME_ATTEMPTS = 50;

/** Registered by the Copilot extension's OpenRouter provider. */
const JOIN_PRO_WAITLIST_COMMAND = 'arni.joinProWaitlist';

/**
 * Ready ideas, opened on request from the new-chat screen. A project idea
 * creates a folder with its rules in AGENTS.md; a task idea opens a chat
 * without a folder. Both only prefill the composer.
 */
export class StarterProjectGallery extends Disposable {
	readonly element: HTMLElement;
	readonly modelPickerButton: HTMLButtonElement;
	private readonly _ideaInput: HTMLTextAreaElement;
	private readonly _ideaButton: HTMLButtonElement;
	private readonly _cards: HTMLElement;
	private readonly _moreButton: HTMLButtonElement;
	private readonly _path: HTMLElement;
	private readonly _status: HTMLElement;
	private _parentUri: URI;
	/** A folder this gallery created whose task has not started yet, reused on retry. */
	private _pendingFolder: { readonly uri: URI; readonly prompt: string; readonly professionId: string } | undefined;
	private _busy = false;

	constructor(
		container: HTMLElement,
		/** Opens a session in the folder with `prompt` in the composer; sends it when `submit` is set. */
		private readonly _startProject: (folderUri: URI, prompt: string, professionId: string, submit: boolean) => Promise<void>,
		/** Opens a chat without a folder with `prompt` in the composer. */
		private readonly _startTask: (prompt: string, professionId: string) => Promise<void>,
		private readonly _useExistingFolder: () => void,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IFileService private readonly _fileService: IFileService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IStorageService private readonly _storageService: IStorageService,
		@IPathService pathService: IPathService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		const storedParent = this._storageService.get(STARTER_PROJECT_PARENT_KEY, StorageScope.APPLICATION);
		const parsedParent = storedParent ? URI.parse(storedParent) : undefined;
		this._parentUri = parsedParent?.scheme === 'file' ? parsedParent : joinPath(pathService.userHome({ preferLocal: true }), 'Arni Projects');

		this.element = dom.append(container, dom.$('section.starter-project-gallery'));
		this._register(toDisposable(() => this.element.remove()));
		this.element.setAttribute('aria-label', localize('starterProjects.heading', "Идеи для начала"));
		dom.append(this.element, dom.$('h2.starter-project-gallery-title')).textContent = localize('starterProjects.heading', "Идеи для начала");
		dom.append(this.element, dom.$('p.starter-project-gallery-description')).textContent = localize('starterProjects.intro', "Выберите идею — задача появится в поле ввода, допишите её и отправьте. Для проектов Arni создаст папку с правилами.");

		const ideaRow = dom.append(this.element, dom.$('.starter-project-idea'));
		this._ideaInput = dom.append(ideaRow, dom.$('textarea.starter-project-idea-input')) as HTMLTextAreaElement;
		this._ideaInput.rows = 3;
		this._ideaInput.placeholder = localize('starterProjects.ideaPlaceholder', "Например: сайт для моей кофейни с меню и картой");
		this._ideaInput.setAttribute('aria-label', localize('starterProjects.ideaLabel', "Опишите приложение для Программиста"));
		const actions = dom.append(ideaRow, dom.$('.starter-project-actions'));
		this.modelPickerButton = dom.append(actions, dom.$('button.starter-project-link.starter-project-model')) as HTMLButtonElement;
		this.modelPickerButton.type = 'button';
		this.modelPickerButton.setAttribute('aria-haspopup', 'dialog');
		this.modelPickerButton.textContent = localize('starterProjects.chooseModel', "Выбрать модель");
		this._ideaButton = dom.append(actions, dom.$('button.starter-project-create')) as HTMLButtonElement;
		this._ideaButton.type = 'button';
		this._ideaButton.textContent = localize('starterProjects.create', "Создать с Программистом");
		this._register(dom.addDisposableListener(this._ideaButton, dom.EventType.CLICK, () => void this._createFromIdea()));
		this._register(dom.addDisposableListener(this._ideaInput, dom.EventType.KEY_DOWN, event => {
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				dom.EventHelper.stop(event, true);
				void this._createFromIdea();
			}
		}));

		dom.append(this.element, dom.$('p.starter-project-cards-heading')).textContent = localize('starterProjects.readyIdeas', "Или начните с готовой идеи:");
		this._cards = dom.append(this.element, dom.$('.starter-project-cards'));
		const extraCards: HTMLButtonElement[] = [];
		for (const [index, idea] of getStarterIdeas().entries()) {
			const button = dom.append(this._cards, dom.$('button.starter-project-card')) as HTMLButtonElement;
			button.type = 'button';
			if (index >= 6) {
				button.hidden = true;
				extraCards.push(button);
			}
			const profession = getArniAgentIdentity(idea.professionId)!;
			button.dataset.agentId = profession.id;
			button.dataset.kind = idea.kind;
			button.setAttribute('aria-label', `${idea.title}. ${idea.description}. ${profession.name}`);
			const icon = dom.append(button, renderIcon(idea.icon));
			icon.setAttribute('aria-hidden', 'true');
			dom.append(button, dom.$('span.starter-project-card-title')).textContent = idea.title;
			dom.append(button, dom.$('span.starter-project-card-description')).textContent = idea.description;
			const author = dom.append(button, dom.$('span.starter-project-card-profession'));
			author.textContent = idea.kind === 'project'
				? localize('starterProjects.professionProject', "{0} · новая папка", profession.name)
				: localize('starterProjects.professionTask', "{0} · чат", profession.name);
			this._register(this._hoverService.setupDelayedHover(button, { content: idea.tooltip }));
			this._register(dom.addDisposableListener(button, dom.EventType.CLICK, () => void this._startIdea(idea)));
		}
		this._moreButton = dom.append(this.element, dom.$('button.starter-project-link.starter-project-more')) as HTMLButtonElement;
		this._moreButton.type = 'button';
		this._moreButton.textContent = localize('starterProjects.more', "Все идеи");
		this._register(dom.addDisposableListener(this._moreButton, dom.EventType.CLICK, () => {
			for (const card of extraCards) {
				card.hidden = false;
			}
			this._moreButton.hidden = true;
			extraCards[0]?.focus();
		}));

		this._status = dom.append(this.element, dom.$('p.starter-project-status'));
		this._status.setAttribute('role', 'status');

		const footer = dom.append(this.element, dom.$('.starter-project-footer'));
		const location = dom.append(footer, dom.$('.starter-project-location'));
		dom.append(location, dom.$('span.starter-project-location-label')).textContent = localize('starterProjects.location', "Проекты сохраняются в");
		this._path = dom.append(location, dom.$('code.starter-project-path'));
		this._path.textContent = this._parentUri.fsPath;
		const changeButton = dom.append(location, dom.$('button.starter-project-link.starter-project-change-location')) as HTMLButtonElement;
		changeButton.type = 'button';
		changeButton.textContent = localize('starterProjects.changeLocation', "Изменить");
		this._register(dom.addDisposableListener(changeButton, dom.EventType.CLICK, () => void this._changeLocation()));
		const existingButton = dom.append(footer, dom.$('button.starter-project-link.starter-project-existing')) as HTMLButtonElement;
		existingButton.type = 'button';
		existingButton.textContent = localize('starterProjects.existingFolder', "У меня уже есть папка с проектом");
		this._register(dom.addDisposableListener(existingButton, dom.EventType.CLICK, () => {
			if (!this._busy) {
				this._useExistingFolder();
			}
		}));

		const pro = dom.append(footer, dom.$('.starter-project-pro'));
		dom.append(pro, dom.$('span')).textContent = localize('starterProjects.availableModels', "Выберите доступную вашему аккаунту модель перед запуском. Для платных моделей нужен бюджет API.");
		const proButton = dom.append(pro, dom.$('button.starter-project-link')) as HTMLButtonElement;
		proButton.type = 'button';
		proButton.textContent = localize('starterProjects.proNotify', "Сообщить о запуске");
		this._register(dom.addDisposableListener(proButton, dom.EventType.CLICK, () => {
			this._commandService.executeCommand(JOIN_PRO_WAITLIST_COMMAND).catch(() => {
				this._status.textContent = localize('starterProjects.proUnavailable', "Сначала войдите в аккаунт.");
			});
		}));
	}

	focus(): void {
		this._ideaInput.focus();
	}

	private async _changeLocation(): Promise<void> {
		if (this._busy) {
			return;
		}
		try {
			const defaultUri = await this._fileService.exists(this._parentUri) ? this._parentUri : dirname(this._parentUri);
			const result = await this._fileDialogService.showOpenDialog({
				defaultUri,
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
			});
			const selected = result?.[0];
			if (selected?.scheme === 'file') {
				this._parentUri = selected;
				this._storageService.store(STARTER_PROJECT_PARENT_KEY, selected.toString(), StorageScope.APPLICATION, StorageTarget.MACHINE);
				this._path.textContent = selected.fsPath;
			}
		} catch (error) {
			this._status.textContent = localize('starterProjects.changeLocationFailed', "Не удалось выбрать каталог: {0}", error instanceof Error ? error.message : String(error));
		}
	}

	private async _createFromIdea(): Promise<void> {
		const idea = this._ideaInput.value.trim();
		if (!idea) {
			this._status.textContent = localize('starterProjects.emptyIdea', "Опишите, что хотите создать, или выберите готовую идею ниже.");
			this._ideaInput.focus();
			return;
		}
		// The user wrote the task and pressed Create, so it is sent right away.
		const title = localize('starterProjects.custom.title', "Мой проект");
		await this._createProject(CUSTOM_PROJECT_FOLDER_NAME, getProjectRulesFile(title, getWebPageRules()), idea, 'programmer', true);
	}

	private async _startIdea(idea: IStarterIdea): Promise<void> {
		if (idea.kind === 'project') {
			await this._createProject(idea.folderName!, getProjectRulesFile(idea.title, idea.rules!), idea.prompt, idea.professionId, false);
			return;
		}
		if (this._busy) {
			return;
		}
		this._busy = true;
		this._status.textContent = '';
		try {
			await this._startTask(idea.prompt, idea.professionId);
		} catch (error) {
			this._status.textContent = localize('starterProjects.taskFailed', "Не удалось открыть чат: {0}", error instanceof Error ? error.message : String(error));
		} finally {
			this._busy = false;
		}
	}

	private async _createProject(baseName: string, rulesFile: string, prompt: string, professionId: string, submit: boolean): Promise<void> {
		if (this._busy) {
			return;
		}
		this._busy = true;
		this.element.classList.add('busy');
		this._ideaButton.disabled = true;
		this._status.textContent = localize('starterProjects.creating', "Создаём проект…");
		let folderUri: URI | undefined;
		try {
			const pending = this._pendingFolder;
			if (pending && pending.prompt === prompt && pending.professionId === professionId && dirname(pending.uri).toString() === this._parentUri.toString()) {
				folderUri = pending.uri;
			} else {
				folderUri = await this._findFreeFolder(baseName);
				await this._fileService.createFolder(folderUri);
				await this._fileService.writeFile(joinPath(folderUri, PROJECT_RULES_FILE_NAME), VSBuffer.fromString(rulesFile));
				this._pendingFolder = { uri: folderUri, prompt, professionId };
			}
			this._status.textContent = localize('starterProjects.starting', "Папка {0} создана. Открываем чат…", folderUri.fsPath);
			await this._startProject(folderUri, prompt, professionId, submit);
			this._pendingFolder = undefined;
			this._ideaInput.value = '';
			this._status.textContent = '';
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._status.textContent = folderUri && this._pendingFolder?.uri.toString() === folderUri.toString()
				? localize('starterProjects.startFailed', "Папка создана, но чат не открыт: {0}", message)
				: localize('starterProjects.createFailed', "Не удалось создать папку проекта: {0}", message);
		} finally {
			this._busy = false;
			this.element.classList.remove('busy');
			this._ideaButton.disabled = false;
		}
	}

	/** Picks `name`, then `name-2`, `name-3`… so a click never collides with an earlier project. */
	private async _findFreeFolder(baseName: string): Promise<URI> {
		for (let attempt = 1; attempt <= MAX_FOLDER_NAME_ATTEMPTS; attempt++) {
			const candidate = joinPath(this._parentUri, attempt === 1 ? baseName : `${baseName}-${attempt}`);
			if (!await this._fileService.exists(candidate)) {
				return candidate;
			}
		}
		throw new Error(localize('starterProjects.noFreeName', "В каталоге уже слишком много папок {0}. Выберите другой каталог.", baseName));
	}
}

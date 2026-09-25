/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/starterProjectGallery.css';
import * as dom from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IPathService } from '../../../../workbench/services/path/common/pathService.js';

const STARTER_PROJECT_PARENT_KEY = 'sessions.starterProjects.parentFolder';

interface IStarterProjectIdea {
	readonly title: string;
	readonly description: string;
	readonly tooltip: string;
	readonly folderName: string;
	readonly icon: ThemeIcon;
	readonly prompt: string;
}

function getStarterProjectIdeas(): readonly IStarterProjectIdea[] {
	return [
		{
			title: localize('starterProjects.game.title', "Игра"),
			description: localize('starterProjects.game.description', "Браузерная «Змейка»"),
			tooltip: localize('starterProjects.game.tooltip', "Игра со счётом, управлением с клавиатуры и телефона и кнопкой перезапуска. Работает прямо в браузере."),
			folderName: 'snake-game',
			icon: Codicon.game,
			prompt: localize('starterProjects.game.prompt', "Создай с нуля браузерную игру «Змейка» в этой пустой папке. Используй HTML, CSS и JavaScript без внешних зависимостей. Добавь счёт, управление с клавиатуры и телефона, экран проигрыша и перезапуск. Создай необходимые файлы. Не используй Python и не запускай серверы: всё должно работать, если просто открыть index.html в браузере. Проверь основной сценарий. В конце объясни, как открыть игру и что можно улучшить дальше."),
		},
		{
			title: localize('starterProjects.landing.title', "Лендинг"),
			description: localize('starterProjects.landing.description', "Страница для вашей идеи"),
			tooltip: localize('starterProjects.landing.tooltip', "Адаптивная страница с первым экраном, преимуществами и кнопкой действия. Текст и оформление можно изменить позже."),
			folderName: 'landing-page',
			icon: Codicon.layout,
			prompt: localize('starterProjects.landing.prompt', "Создай с нуля адаптивный лендинг в этой пустой папке. Если тема проекта неизвестна, возьми понятный пример и явно обозначь заменяемый текст. Сделай выразительный первый экран, преимущества, примеры и кнопку действия. Используй HTML, CSS и JavaScript без внешних зависимостей. Создай необходимые файлы. Не используй Python и не запускай серверы: всё должно работать, если просто открыть index.html в браузере. Проверь страницу на узком и широком экране. В конце объясни, какие тексты мне заменить."),
		},
		{
			title: localize('starterProjects.portfolio.title', "Портфолио"),
			description: localize('starterProjects.portfolio.description', "Личный сайт с проектами"),
			tooltip: localize('starterProjects.portfolio.tooltip', "Готовый личный сайт: информация о вас, карточки проектов и контакты. Примерные данные легко заменить."),
			folderName: 'my-portfolio',
			icon: Codicon.account,
			prompt: localize('starterProjects.portfolio.prompt', "Создай с нуля адаптивный сайт-портфолио в этой пустой папке. Добавь блок «Обо мне», карточки проектов и контакты. Используй явно обозначенные примерные данные, которые я смогу заменить. Сделай сайт на HTML, CSS и JavaScript без внешних зависимостей. Создай необходимые файлы. Не используй Python и не запускай серверы: всё должно работать, если просто открыть index.html в браузере. Проверь отображение на узком и широком экране. В конце объясни, где поменять текст и изображения."),
		},
		{
			title: localize('starterProjects.quiz.title', "Квиз"),
			description: localize('starterProjects.quiz.description', "Вопросы и результат"),
			tooltip: localize('starterProjects.quiz.tooltip', "Небольшая викторина с несколькими вопросами, подсчётом баллов и возможностью пройти её заново."),
			folderName: 'my-quiz',
			icon: Codicon.question,
			prompt: localize('starterProjects.quiz.prompt', "Создай с нуля браузерный квиз в этой пустой папке. Сделай несколько интересных примерных вопросов, понятный выбор ответов, подсчёт баллов, экран результата и повторное прохождение. Используй HTML, CSS и JavaScript без внешних зависимостей. Не используй Python и не запускай серверы: всё должно работать, если просто открыть index.html в браузере. Проверь прохождение квиза. Объясни, где заменить вопросы."),
		},
		{
			title: localize('starterProjects.habits.title', "Трекер привычек"),
			description: localize('starterProjects.habits.description', "Отмечайте прогресс по дням"),
			tooltip: localize('starterProjects.habits.tooltip', "Добавляйте привычки и отмечайте выполненные дни. Отметки сохраняются в браузере без регистрации."),
			folderName: 'habit-tracker',
			icon: Codicon.calendar,
			prompt: localize('starterProjects.habits.prompt', "Создай с нуля простой трекер привычек в этой пустой папке. Пользователь должен добавлять привычки, отмечать выполненные дни и видеть прогресс за неделю. Сохраняй данные локально в браузере без аккаунта и сервера. Используй HTML, CSS и JavaScript без внешних зависимостей. Не используй Python и не запускай серверы: всё должно работать, если просто открыть index.html в браузере. Проверь добавление и сохранение привычки."),
		},
		{
			title: localize('starterProjects.catalog.title', "Каталог"),
			description: localize('starterProjects.catalog.description', "Карточки с поиском"),
			tooltip: localize('starterProjects.catalog.tooltip', "Небольшой каталог товаров или работ: карточки, поиск и фильтры. Оплата и аккаунт не нужны."),
			folderName: 'my-catalog',
			icon: Codicon.listUnordered,
			prompt: localize('starterProjects.catalog.prompt', "Создай с нуля адаптивный каталог товаров или работ в этой пустой папке. Добавь примерные карточки, поиск и фильтр по категориям. Не подключай оплату или аккаунты. Используй HTML, CSS и JavaScript без внешних зависимостей. Не используй Python и не запускай серверы: всё должно работать, если просто открыть index.html в браузере. Проверь поиск и фильтрацию. Объясни, где заменить данные карточек."),
		},
	];
}

/** Wraps a free-form idea into a task the agent can finish in an empty folder. */
function getCustomIdeaPrompt(idea: string): string {
	return localize('starterProjects.custom.prompt', "Создай с нуля в этой пустой папке: {0}\n\nЕсли я не указал технологии, используй HTML, CSS и JavaScript без внешних зависимостей. Создай необходимые файлы. Если получается веб-страница, не используй Python и не запускай серверы: всё должно работать, если просто открыть index.html в браузере. Проверь основной сценарий. В конце простыми словами объясни, как открыть результат и что можно улучшить дальше.", idea);
}

const CUSTOM_PROJECT_FOLDER_NAME = 'my-project';
const MAX_FOLDER_NAME_ATTEMPTS = 50;

/**
 * The first-run home: describe an idea or pick a ready one, and Arni creates a
 * fresh folder for it and starts the agent there in one step.
 */
export class StarterProjectGallery extends Disposable {
	readonly element: HTMLElement;
	private readonly _ideaInput: HTMLTextAreaElement;
	private readonly _ideaButton: HTMLButtonElement;
	private readonly _cards: HTMLElement;
	private readonly _moreButton: HTMLButtonElement;
	private readonly _path: HTMLElement;
	private readonly _status: HTMLElement;
	private _parentUri: URI;
	/** A folder this gallery created whose task has not started yet, reused on retry. */
	private _pendingFolder: { readonly uri: URI; readonly prompt: string } | undefined;
	private _busy = false;

	constructor(
		container: HTMLElement,
		private readonly _startProject: (folderUri: URI, prompt: string) => Promise<void>,
		private readonly _useExistingFolder: () => void,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IFileService private readonly _fileService: IFileService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IStorageService private readonly _storageService: IStorageService,
		@IPathService pathService: IPathService,
	) {
		super();
		const storedParent = this._storageService.get(STARTER_PROJECT_PARENT_KEY, StorageScope.APPLICATION);
		const parsedParent = storedParent ? URI.parse(storedParent) : undefined;
		this._parentUri = parsedParent?.scheme === 'file' ? parsedParent : joinPath(pathService.userHome({ preferLocal: true }), 'Arni Projects');

		this.element = dom.append(container, dom.$('section.starter-project-gallery'));
		this._register(toDisposable(() => this.element.remove()));
		this.element.setAttribute('aria-label', localize('starterProjects.heading', "Что создадим?"));
		dom.append(this.element, dom.$('h2.starter-project-gallery-title')).textContent = localize('starterProjects.heading', "Что создадим?");
		dom.append(this.element, dom.$('p.starter-project-gallery-description')).textContent = localize('starterProjects.intro', "Опишите идею своими словами — Arni создаст для неё папку и начнёт работу.");

		const ideaRow = dom.append(this.element, dom.$('.starter-project-idea'));
		this._ideaInput = dom.append(ideaRow, dom.$('textarea.starter-project-idea-input')) as HTMLTextAreaElement;
		this._ideaInput.rows = 3;
		this._ideaInput.placeholder = localize('starterProjects.ideaPlaceholder', "Например: сайт для моей кофейни с меню и картой");
		this._ideaInput.setAttribute('aria-label', localize('starterProjects.ideaLabel', "Опишите идею проекта"));
		this._ideaButton = dom.append(ideaRow, dom.$('button.starter-project-create')) as HTMLButtonElement;
		this._ideaButton.type = 'button';
		this._ideaButton.textContent = localize('starterProjects.create', "Создать");
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
		for (const [index, idea] of getStarterProjectIdeas().entries()) {
			const button = dom.append(this._cards, dom.$('button.starter-project-card')) as HTMLButtonElement;
			button.type = 'button';
			if (index >= 3) {
				button.hidden = true;
				extraCards.push(button);
			}
			button.setAttribute('aria-label', `${idea.title}. ${idea.description}`);
			const icon = dom.append(button, renderIcon(idea.icon));
			icon.setAttribute('aria-hidden', 'true');
			dom.append(button, dom.$('span.starter-project-card-title')).textContent = idea.title;
			dom.append(button, dom.$('span.starter-project-card-description')).textContent = idea.description;
			this._register(this._hoverService.setupDelayedHover(button, { content: idea.tooltip }));
			this._register(dom.addDisposableListener(button, dom.EventType.CLICK, () => void this._createProject(idea.folderName, idea.prompt)));
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
		await this._createProject(CUSTOM_PROJECT_FOLDER_NAME, getCustomIdeaPrompt(idea));
	}

	private async _createProject(baseName: string, prompt: string): Promise<void> {
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
			if (pending && pending.prompt === prompt && dirname(pending.uri).toString() === this._parentUri.toString()) {
				folderUri = pending.uri;
			} else {
				folderUri = await this._findFreeFolder(baseName);
				await this._fileService.createFolder(folderUri);
				this._pendingFolder = { uri: folderUri, prompt };
			}
			this._status.textContent = localize('starterProjects.starting', "Папка {0} создана. Запускаем агента…", folderUri.fsPath);
			await this._startProject(folderUri, prompt);
			this._pendingFolder = undefined;
			this._ideaInput.value = '';
			this._status.textContent = '';
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._status.textContent = folderUri && this._pendingFolder?.uri.toString() === folderUri.toString()
				? localize('starterProjects.startFailed', "Папка создана, но задача не запущена: {0}", message)
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

# Arni Code — план тестирования (первый проход)

Документ для QA. Охватывает продукт **Arni Code** (форк Code-OSS / VS Code), кастомные потоки Arnion и пробелы покрытия. Апстрим-функциональность VS Code огромна; здесь приоритет — то, чем Arni отличается от Microsoft VS Code.

**Версия среза:** включает фиксы C1–C11 (C4/C5 в PR #11; остальные в этом изменении).  
**Язык UI по умолчанию:** русский (`src/main.ts` возвращает locale `ru`, если в `argv.json` нет `locale`).  
**Маркетплейс расширений:** Open VSX, не Microsoft Marketplace.

---

## 1. Что это за продукт и стек

**Arni Code** — десктопный редактор кода (Electron) компании **Arnion**. Это Code-OSS с:

- встроенным AI-агентом **Arni** (чат в сайдбаре + интеграция в стандартный Chat / Copilot Chat);
- входом через **Яндекс ID** (OAuth 2.0 + PKCE, loopback `127.0.0.1`);
- бэкенд-прокси **Vercel** (`https://arni-backend.vercel.app`) — обмен токена Яндекса на JWT и проксирование моделей;
- моделями через **OpenRouter** (по умолчанию в настройках: `qwen/qwen-2.5-coder-32b-instruct`; фактический чат Arni шлёт `openrouter/auto`);
- русским языковым пакетом и отключённой Welcome-страницей;
- дистрибуцией Windows (Inno Setup user installer + zip), без цифровой подписи (см. [WINDOWS_CODE_SIGNING.md](./WINDOWS_CODE_SIGNING.md));
- галереей расширений **Open VSX** (см. [MARKETPLACE.md](./MARKETPLACE.md)).

### Стек

| Слой | Технологии |
|------|------------|
| Runtime | Electron, Node.js **24.18** (`.nvmrc`), TypeScript, ESM |
| Ядро | Code-OSS: `src/vs/{base,platform,editor,workbench,code,server,sessions}` |
| UI | Workbench + webview (чат Arni) |
| AI | `extensions/arni-agent`, встроенный `extensions/copilot` (GitHub Copilot Chat, publisher `GitHub`), BYOK OpenRouter |
| Auth | `extensions/yandex-authentication`, VS Code Authentication API |
| Backend | Vercel proxy `arni-backend.vercel.app` (`/api/auth/exchange`, chat completions) |
| Marketplace | Open VSX |
| Сборка | gulp, esbuild (кастомные расширения), Inno Setup (Windows) |
| Локализация | `extensions/vscode-language-pack-ru` (MS-CEINTL), дефолт `ru` |

Идентичность продукта задаётся в `product.json`: `nameShort`/`nameLong` = **Arni Code**, `applicationName` = `arni-code`, `urlProtocol` = `arni-code`, данные в `.arni-code`.

---

## 2. Критические пользовательские потоки

Приоритет для регрессии и ручного прогона. Потоки VS Code «открыть файл / git / debug / terminal» считать базовыми, но **не** главным риском этого форка.

### P0 — вход и агент

1. **Первый запуск Windows-сборки**
   - SmartScreen / «Неизвестный издатель» (сборка не подписана).
   - Установка user-setup `.exe` и запуск portable `.zip`.
   - Иконка, имя «Arni Code», протокол `arni-code://`.
   - UI на русском без ручного `--locale`.
   - Welcome не открывается (`workbench.startupEditor: none`).
   - Данные пишутся в `%APPDATA%\.arni-code` (не `.vscode`).

2. **Яндекс ID (OAuth)**
   - Onboarding: кнопка «Continue with Yandex ID».
   - Диалог Chat setup «Sign in to use Agents»: «Продолжить с Яндекс ID».
   - Команды `Arni: Sign In with Yandex ID` / `Sign Out`.
   - Браузер открывает `oauth.yandex.ru`, loopback callback, страница успеха на русском.
   - Аккаунт виден в Accounts / статус-баре.
   - Повторный вход, отмена в браузере, timeout, повторный sign-out.

3. **Чат Arni (сайдбар `arni.chatView`)**
   - `Ctrl+Shift+A` / `Arni: Open Agent`.
   - Без сессии Яндекса — ошибка «необходимо войти через Яндекс».
   - Сообщение → стриминг ответа через Vercel (`backendUrl` + JWT).
   - Новый чат, ошибки 401 (протухший JWT) и 402 (нет баланса).
   - Настройки `arni.*` (см. риски: часть настроек сейчас не используется чатом).

4. **Chat / Copilot Chat (workbench)**
   - Кнопка Яндекса в setup-диалоге.
   - После входа: список моделей OpenRouter (BYOK), отправка сообщения.
   - Anthropic-модели идут на `/messages`, остальные на `/chat/completions`.
   - Fallback на ручной API-ключ, если JWT не получен.

### P1 — продукт и дистрибуция

5. **Маркетплейс Open VSX** — поиск, установка, обновление; установка из `.vsix`; отсутствие Microsoft-only расширений (Remote SSH/WSL/Containers, GitHub Copilot Marketplace).
6. **Язык** — дефолт `ru`; переключение Display Language на English; смесь RU/EN в кастомных строках.
7. **Getting Started** (если открыть вручную) — пункты «Open Arni…» / «Configure AI Provider…».
8. **Windows-сборка** — workflow `build-windows.yml`; installer vs zip; отсутствие подписи; иконки ICO/PNG.

### P2 — апстрим (дымовой прогон)

9. Открыть папку, редактировать файл, поиск, терминал, git, отладка JS, Command Palette.
10. Расширения языка (TS/Python grammar), темы Dark/Light 2026.

Не в скоупе текущего продукта (бэклог): VK ID, Google OAuth напрямую, FIM/Qwen inline completions, семантический индекс, автообновления, Trusted Signing.

---

## 3. Инвентарь автотестов и пробелы

### Что есть (наследство Code-OSS / Copilot)

| Слой | Где | Как гонять | Объём (порядок) |
|------|-----|------------|-----------------|
| Unit (ядро) | `src/vs/**/test/**/*.test.ts` | `./scripts/test.sh` / `scripts\test.bat`; `--run` / `--glob` | ~1900 файлов |
| Unit (browser) | слои `common`/`browser` | `npm run test-browser` (Playwright) | — |
| Unit (node) | | `npm run test-node -- --run <file>` | — |
| Extension tests | `extensions/**/test` | `scripts/test-integration.sh` | ~640 файлов |
| Copilot / BYOK | `extensions/copilot/**/*.spec.ts` (vitest) | `npm --prefix extensions/copilot test` | ~400 spec |
| OpenRouter capabilities | `extensions/copilot/src/extension/byok/vscode-node/test/openRouterProvider.spec.ts` | vitest | только context window / max tokens |
| Smoke UI | `test/smoke` | `npm run smoketest` | ~36 TS, нет сценариев Arni |
| API integration | `test/integration/browser` | `scripts/test-integration.sh` | — |
| Sanity релиза | `test/sanity` | wiki Microsoft; подпись / инсталлятор | не адаптирован под Arni |
| Agent Host e2e | `src/vs/platform/agentHost/test/node/e2e` | `npm run test-agent-host-e2e` | replay фикстур Copilot/Claude/Codex, **не** Arni/Yandex |
| Sessions e2e | `src/vs/sessions/test/e2e` | CI `sessions-e2e.yml` | апстрим |
| Build scripts | `build/` | `npm run test-build-scripts` | — |

Корневой `npm test` **намеренно падает** и печатает: запускать скрипты из `scripts/`.

### Чего нет (критичные пробелы)

- Unit-тесты loopback (CSRF/timeout/XSS) в `extensions/yandex-authentication/`.
- Unit-тесты URL бэкенда, JWT TTL, routing настроек и webview CSP/locale в `extensions/arni-agent/`.
- Нет интеграционных тестов на `ChatSetupStrategy.SetupWithYandexProvider` и живой обмен Yandex→JWT.
- OpenRouter spec **не** покрывает обмен Yandex→JWT и URL бэкенда.
- Smoke/sanity **не** знают бренд Arni, locale `ru`, Open VSX, unsigned Windows.
- CI `.github/workflows/pr.yml` на форке — slim `ubuntu-latest` (тест/compile `arni-agent` и `yandex-authentication`). Полный апстрим-матрикс Code-OSS на 1ES **намеренно пропущен**.

Итог: апстрим покрыт густо; дифференциальный продукт Arni имеет точечные unit-тесты в `arni-agent` / `yandex-authentication` плюс ручной прогон P0.

---

## 4. Находки по коду (баги и риски)

Метки: **confirmed** = видно в коде без запуска; **hypothesis** = нужно подтвердить на сборке/бэкенде.

### Confirmed

| ID | Суть | Где | Статус |
|----|------|-----|--------|
| C1 | Сообщение webview `saveApiKey` **нигде не обрабатывается**. `checkApiKey` всегда отвечает `apiKeySaved`. UI ввода OpenRouter-ключа мёртвый. | `extensions/arni-agent/src/webview/getWebviewContent.ts`, `chatPanel.ts` | **Исправлено** — `saveApiKey` пишет в SecretStorage; `checkApiKey` показывает setup, пока нет сессии Яндекса и нет ключа |
| C2 | Чат сайдбара **игнорирует** `arni.provider`, `arni.apiBaseUrl`, `arni.modelId`, `arni.setApiKey`. Всегда JWT + `backendUrl` + модель `openrouter/auto`. Getting Started всё ещё зовёт «Configure AI Provider». | `chatPanel.ts` `handleMessage`; `package.json` contributes | **Исправлено** — настройки влияют на сайдбар (`arniBackend.ts` `resolveSidebarChatRequest`); JWT-путь использует `arni.modelId` и `{backendUrl}/api` |
| C3 | `ProviderFactory` не используется чатом. Ветка `anthropic` падает в `default` → `https://api.arni.ai/v1`. | `providerFactory.ts` | **Исправлено** — фабрика/роутинг с живым Arni backend; `anthropic` больше не падает в `api.arni.ai` |
| C4 | Access/refresh token Яндекса сохраняются (`expiresAt`, `refreshToken`), **refresh не реализован**. Просроченный access token будет слаться, пока пользователь не перелогинится. | `yandexAuthProvider.ts` | **Исправлено в PR #11** |
| C5 | Несовпадение `state` (CSRF) показывает ошибку в браузере, но **не reject-ит** `waitForCode` — IDE висит до таймаута 5 мин. | `loopbackServer.ts` | **Исправлено в PR #11** |
| C6 | `error_description` из query **без экранирования** вставляется в HTML callback-страницы (XSS на loopback). | `loopbackServer.ts` `sendErrorResponse` | **Исправлено** — `escapeHtml` + unit-тест XSS |
| C7 | JWT в сайдбаре кэшируется в SecretStorage **без TTL**; сброс только после ошибки с `"401"` в тексте. Copilot-путь наоборот **обменивает токен на каждый** `provideLanguageModelChatInformation`. | `chatPanel.ts`, `openRouterProvider.ts` | **Исправлено** — сайдбар: `exp` JWT или fallback 45 мин, re-exchange за 5 мин до истечения; logout/401 по-прежнему чистят кэш |
| C8 | После Yandex в Chat setup **не вызывается** `controller.setup()` (установка/entitlement Copilot). Успех = «сессия Яндекса есть». | `chatSetupRunner.ts` `SetupWithYandexProvider` | **Исправлено** — после сессии Яндекса вызывается `setup({ skipSignIn: true })` |
| C9 | `product.defaultChatAgent.extensionId` / `chatExtensionId` = `arnion.arni-agent`, тогда как полноценный чат — bundled `GitHub.copilot-chat`. Workbench считает chat-расширением сайдбар-агент. | `product.json`, `extensions/copilot/package.json` | **Исправлено** — `chatExtensionId` = `GitHub.copilot-chat`; сайдбар Arni остаётся `arni.chatView` / `completionsMenuCommand` |
| C10 | В webview Arni нет CSP. New Chat сбрасывает приветствие на **английский**, первый экран — **русский**. | `getWebviewContent.ts` | **Исправлено** — CSP + nonce; New Chat использует ту же локаль (ru по умолчанию) |
| C11 | PR CI (`pr.yml`) привязан к пулам Microsoft 1ES — для этого форка, скорее всего, мёртв. | `.github/workflows/pr.yml` | **Исправлено** — slim `ubuntu-latest`: тест/compile `arni-agent` и `yandex-authentication`; полный 1ES-матрикс явно пропущен |
| C12 | Windows-сборки не подписываются; SmartScreen ожидаем. Trusted Signing только в бэклоге. | `docs/WINDOWS_CODE_SIGNING.md`, `build/azure-pipelines/common/sign-win32.ts` (ESRP Microsoft) | **Ожидаемое состояние продукта** (не баг к фиксу) |

Контракт Yandex → JWT → chat: [AUTH_CHAIN.md](./AUTH_CHAIN.md).

### Hypothesis (проверить вручную)

| ID | Суть | Как проверить |
|----|------|----------------|
| H1 | **Рассинхрон URL бэкенда.** Исторически чат бил `{backendUrl}/chat/completions` без `/api`. Клиент теперь всегда бьёт `{backendUrl}/api/chat/completions` (и `{backendUrl}/api/auth/exchange`). | Network tab / прокси; сравнить 200 vs 404 |
| H2 | Случайный порт loopback (`listen(0)`) может **не совпасть** с Redirect URI в кабинете Яндекс OAuth. Логин падает на стороне Яндекса. | Реальный логин; ошибка `redirect_uri mismatch` |
| H3 | Два чата (сайдбар vs Copilot Chat) расходятся: разный кэш JWT, разный model id, разный setup. Пользователь «вошёл», но один из чатов всё равно просит GitHub. | Войти через Яндекс, открыть оба чата |
| H4 | `yandex.clientSecret` в user settings — секрет в plaintext settings.json, если кто-то его задаст. | Не использовать в проде; проверить, нужен ли секрет при PKCE |
| H5 | Пустые `termsStatementUrl` / `privacyStatementUrl` в `product.json` → битые ссылки в Copilot disclaimer. | Открыть Chat setup footer |
| H6 | Языковой пакет RU может не покрывать кастомные строки (Yandex/Arni) — смесь языков. | Первый запуск, onboarding, чат |
| H7 | Zip в `build-windows.yml` ищет `../ArniCode-win32-x64`; gulp пишет туда же (`buildPath` в `gulpfile.vscode.win32.ts`). Если job layout другой — zip пустой (`if-no-files-found: warn`). | Артефакты последнего `workflow_dispatch` |
| H8 | Open VSX: Remote SSH/WSL/Dev Containers недоступны — для части пользователей это блокер, не баг. | Extensions view |
| H9 | Onboarding после Yandex ставит `_userSignedIn = true` и идёт дальше **без** chat setup Copilot (в отличие от GitHub-ветки). | Пройти wizard целиком |
| H10 | Комментарий в `startupPage.ts` («Always open Welcome on first-launch») устарел: при `startupEditor: none` Welcome не открывается. | Первый запуск с чистым профилем |

---

## 5. Чеклист ручного прогона (highest-risk)

Среда: **Windows x64 user-setup или zip** (целевой дистрибутив) **и** при возможности `./scripts/code.sh` с `npm ci` (Linux/macOS). Чистый профиль: удалить `%APPDATA%\.arni-code` / `~/.arni-code`. Нужны: аккаунт Яндекса, сеть, по возможности тестовый баланс на бэкенде.

### A. Установка и первый запуск

- [ ] Инсталлятор запускается; если SmartScreen — «Подробнее → Выполнить в любом случае» (ожидаемо, C12).
- [ ] Приложение называется **Arni Code**, иконка своя, процесс не `Code - OSS` в пользовательском смысле бренда.
- [ ] Интерфейс на русском (меню Файл/Правка, Command Palette).
- [ ] Welcome / Get Started **не** всплывает сам.
- [ ] Папка данных `.arni-code` создалась.
- [ ] Повторный запуск восстанавливает окна/папку.

### B. Яндекс ID

- [ ] `Ctrl+Shift+P` → **Arni: Sign In with Yandex ID** открывает браузер на `oauth.yandex.ru`.
- [ ] После согласия: HTML «Вход в Яндекс ID выполнен», в IDE тост с именем/email.
- [ ] Accounts показывает «Яндекс ID».
- [ ] Sign Out чистит сессию; повторный Sign In проходит.
- [ ] Отмена в браузере: понятная ошибка, IDE не зависает навсегда (следить за C5: до 5 мин).
- [ ] То же с кнопки onboarding и кнопки «Продолжить с Яндекс ID» в Chat setup.
- [ ] Зафиксировать **точный redirect_uri** (host+port+path) — сверка с кабинетом OAuth (H2).

### C. Сайдбар Arni Agent

- [ ] `Ctrl+Shift+A` открывает view «Arni Agent».
- [ ] Без логина: сообщение про вход через Яндекс (не про API-ключ OpenRouter).
- [ ] После логина: стриминг ответа на простой вопрос («напиши fizzbuzz на python»).
- [ ] New Chat очищает историю (приветствие на языке UI, по умолчанию русский — C10).
- [ ] Повтор после убийства сети / 401: предложение отправить ещё раз; второй запрос проходит или явственно падает.
- [ ] DevTools webview: URL запроса chat (`/api/chat/completions`).
- [ ] Кнопка «Получить ключ на OpenRouter» / поле ключа: ключ сохраняется, чат открывается (C1).

### D. Workbench Chat / Agents

- [ ] Открыть Chat view; на setup видна кнопка Яндекса (иконка + «Продолжить с Яндекс ID»).
- [ ] После входа чат **реально** принимает запрос (не крутит GitHub entitlement) — проверка C8/H3.
- [ ] Пикер моделей показывает модели OpenRouter, не только Copilot.
- [ ] Сообщение стримится; ошибка бэкенда читаема.
- [ ] Сравнить ответ/ошибку с сайдбаром Arni на том же аккаунте.

### E. Настройки и провайдеры

- [ ] `Arni: Settings` открывает фильтр `arni`.
- [ ] Смена `arni.backendUrl` влияет на JWT auth+chat (`{backendUrl}/api/...`).
- [ ] Смена `arni.modelId` меняет модель в сайдбаре; `arni.provider` + сохранённый ключ включает BYOK (openai/anthropic/…); с Яндексом `openrouter`/`arni` идут на бэкенд Arni (C2).
- [ ] `Arni: Set API Key` пишет в SecretStorage и используется при BYOK / без сессии Яндекса.

### F. Маркетплейс и язык

- [ ] Extensions: галерея Open VSX, ставится популярное расширение (Prettier / Python).
- [ ] Нет Microsoft Marketplace; Remote-SSH из галереи отсутствует или ставится OSS-аналог.
- [ ] Install from VSIX работает.
- [ ] Configure Display Language → English, reload, UI переключается; кастомные тосты Яндекса остаются на русском.

### G. Windows-артефакты (если есть свежий build)

- [ ] User-setup и zip оба запускаются.
- [ ] Properties → Digital Signatures пусто.
- [ ] Размер артефактов ненулевой; zip не warn-empty (H7).

### H. Дым апстрима (10 мин)

- [ ] Открыть папку с TS-проектом, IntelliSense, сохранить, терминал `node -v`.
- [ ] Git: status / diff (без remote).
- [ ] Проблемы с кодировкой кириллицы в файле и терминале.

### Негативные / границы

- [ ] Нет сети во время OAuth и во время чата.
- [ ] Неверный/отозванный Яндекс-аккаунт.
- [ ] Два окна Arni Code одновременно (один loopback).
- [ ] Proxy / корпоративный MITM на `oauth.yandex.ru` и `arni-backend.vercel.app`.

---

## 6. Локальный / dev setup (для QA и разработчиков)

**Да, локальный запуск из исходников предусмотрен** (как у Code-OSS), но тяжёлый.

Требования: Node **24.18.0**, Python 3, C++ toolchain (VS 2022 на Windows; `build-essential` + X11 libs на Linux), git, ~8+ GB RAM.

```bash
npm ci
# Linux/macOS:
./scripts/code.sh
# Windows:
scripts\code.bat
```

Скрипт сам тянет Electron и компилирует через `preLaunch`. Кастомные расширения:

```bash
npm --prefix extensions/arni-agent install && npm --prefix extensions/arni-agent run build
npm --prefix extensions/yandex-authentication install && npm --prefix extensions/yandex-authentication run build
```

Windows-релиз: GitHub Action **Build Arni Code — Windows x64** (`workflow_dispatch`) → артефакты `ArniCodeSetup-x64` / `ArniCode-win32-x64`.

Dev Container / Codespaces описаны в `.devcontainer/README.md` (апстрим, ссылки на microsoft/vscode).

Ограничения: `npm ci` долгий; полный апстрим-матрикс Code-OSS на 1ES на этом форке не гоняется (slim PR CI покрывает Arni-расширения); для полного AI-потока нужен живой Vercel backend и зарегистрированное Yandex OAuth-приложение (в код зашит client id `5255b6b242694d51b97d71483148321f`).

---

## 7. Рекомендуемый порядок автоматизации (остаток)

1. ~~Unit: loopback CSRF/timeout, сборка URL `{backendUrl}/api/...`.~~ (частично есть: loopback CSRF/XSS, JWT TTL, chat routing, webview CSP/locale.)
2. Integration: mock `oauth.yandex.ru` + mock Vercel exchange + JWT → 200 stream.
3. Smoke: первый запуск `--locale=ru`, команда `yandex.signIn` (stub provider), фокус `arni.chatView`.
4. ~~PR CI на `ubuntu-latest` вместо 1ES.~~ (slim job есть; полный Code-OSS матрикс по-прежнему не гоняется.)
5. Контракт-тест против staging `arni-backend.vercel.app` (auth + chat paths).

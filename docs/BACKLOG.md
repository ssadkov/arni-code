# Arni Code — Бэклог разработки

В этом документе зафиксированы приоритетные задачи и фичи для будущих версий IDE **Arni Code** от компании **Arnion**.

---

## 1. Авторизация и профили пользователей (High Priority)

### 1.1. Интеграция VK ID (`vk-authentication`)
- **Цель**: Предоставить российским разработчикам возможность быстрого входа в IDE через единую экосистему VK ID.
- **Требования**:
  - Создание и публикация OAuth 2.0 / OpenID Connect приложения в панели [VK ID для разработчиков](https://id.vk.com/about/business/go/).
  - Разработка встроенного расширения `extensions/vk-authentication`, регистрирующего провайдера аутентификации `vk` через VS Code Authentication API (`vscode.authentication.registerAuthenticationProvider`).
  - Поддержка входа через локальный HTTP loopback сервер (`http://127.0.0.1:<port>`) и перехват системного протокола `arni-code://auth/vk`.
  - Безопасное хранение Access Token и Refresh Token в Windows Credential Manager (`SecretStorage`).
  - Отображение аватара и имени пользователя VK в нижнем статус-баре и меню аккаунтов.

### 1.2. Интеграция Яндекс ID (`yandex-authentication`) — ✅ РЕАЛИЗОВАНО (v1.0.0)
- **Статус**: Встроено в кодовую базу как нативное расширение `extensions/yandex-authentication/`.
- **Реализовано**:
  - Провайдер `yandex` через VS Code Authentication API (`vscode.authentication.registerAuthenticationProvider`).
  - Локальный HTTP loopback сервер (`http://127.0.0.1:<port>/callback`) с защитой от CSRF (`state`) и поддержкой стандарта PKCE (S256).
  - Интеграция кнопки «Войти через Яндекс ID» в мастер первого запуска (Onboarding Wizard).
  - Запрос профиля через API `https://login.yandex.ru/info` и сохранение сессии в безопасном хранилище `SecretStorage` (Windows Credential Manager).
  - Добавлена настройка `yandex.clientId` и `yandex.clientSecret` для подключения корпоративного приложения Яндекс OAuth.

### 1.3. Прямой Google OAuth 2.0 (`google-authentication`)
- **Цель**: Автономный вход через Google без промежуточного перенаправления через GitHub Social Auth.
- **Требования**:
  - Регистрация десктопного OAuth Client ID в Google Cloud Console.
  - Встроенный OAuth loopback listener для обработки редиректа от Google Accounts.
  - Реализация провайдера `google` в VS Code Authentication API.

---

## 2. AI-агент Arni и интеграции

### 2.1. Инлайн-дополнение кода (Ghost Text / Inline Completions)
- Реализация собственного провайдера `vscode.languages.registerInlineCompletionItemProvider` на базе модели Qwen 2.5 Coder (FIM — Fill In the Middle).
- Поддержка быстрого стриминга токенов с минимальной задержкой (<150ms).

### 2.2. Индексация кодовой базы (Codebase Semantic Indexing)
- Локальная база эмбеддингов (sqlite-vec / vector search) для поиска по всему проекту.
- Умный контекст при обращении к агенту (`@workspace`, `@file`, `@diff`).

### 2.3. Agent Terminal & Multi-step Tools
- Разрешение агенту запускать команды в терминале и анализировать ошибки линтеров и тестов.
- Автоматическое исправление ошибок компиляции.

---

## 3. Дистрибуция и инфраструктура

- Автоматический выпуск GitHub Releases при пуше тегов `v*`.
- Добавление цифровой подписи (Code Signing) для установщика Windows.
- Автоматическое автообновление через Inno Setup background updater.

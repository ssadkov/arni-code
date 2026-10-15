# Arni Code: model, cost and runtime update

Authorized on 2026-10-15. Preserve the user's source checkout and video project.

- [x] Publish verified Qwen3 models for the existing test account, with current prices, supported input modalities and context limits.
- [x] Use one effective context budget across model metadata, agent runtime and usage indicator; preserve response reserve and compaction headroom.
- [x] Select an available model on the starter project screen and carry it into the first request; remember the last choice.
- [x] Cache eligible repeated Bedrock context and account for cache reads/writes at their distinct tariffs.
- [x] Show actual USD request/chat cost, including historical/restored chats and model changes, with explicit estimates when usage is unavailable.
- [x] Stream long-running shell output and progress without paid model polling. Preserve cancellation and command completion semantics.
- [ ] Configure signed macOS DMG/ZIP publication and an authenticated-by-signature update feed, with version/hash/architecture checks and manual bootstrap for older clients.
- [ ] Verify targeted regressions, deploy backend, build clients, install the Windows test client after the user closes it, and provide repeatable model-comparison instructions.

Signing dependency: user has Apple Developer membership but no Mac currently. Use GitHub macOS runners; create a CSR on Windows and configure signing/notarization through protected GitHub secrets. Never put signing material or API credentials in source control.

Media comparison: keep existing source/background and scripts unchanged; compare new-model attempts in separate output folders using the same timestamps and quality criteria. Do not claim that a model switch guarantees correct matting.

## Verification and release status

Backend c59e0d0 was deployed and promoted on 2026-10-15. The additive cache migration and seven account-specific Qwen3 grants are applied for srgsdk@yandex.ru; balance remains $2.571136. Qwen3 VL is the account default. Availability and catalog pricing were verified with AWS APIs; paid production inference remains to be verified in the application.

Backend: 13 conversion/update-feed checks, 17 disposable-PostgreSQL billing checks and 9 media checks passed. Targeted client regression tests cover BYOK limits, model selection, terminal lifecycle, progress and cache metrics. No video inputs or scripts were changed.

The Developer ID certificate matches the local private key (Team RY26UXEX58, expires 2027-02-01). Signing and App Store Connect team-key secrets are configured in GitHub. Read-only Apple Notary API authentication returned HTTP 200. Signed package verification and Apple acceptance are release gates, not yet assumed from credential setup.

## Проверка в приложении

1. Начните новый чат в отдельной папке для повторного теста. Сохраните исходное видео и фон без изменений. На стартовом экране выберите Qwen3 VL 235B A22B: из подключённых Qwen только VL видит скриншоты и кадры. Coder Next подходит для кода и текстовых задач, но не принимает картинки, в том числе оставшиеся в истории.
2. Сначала попросите обработать пять секунд, сохранить отдельные кадры и оценить края и зелёный ореол. Укажите горизонтальный 1920×1080, если нужен такой результат. Полный рендер запускайте после просмотра кадров.
3. Раскройте блок команды → Show Output / Focus Terminal. Живой вывод и таймер работают без опроса модели. Процент и приблизительный ETA появляются, если команда печатает счётчик кадров или распознаваемый прогресс ffmpeg. Время без вывода означает лишь, что процесс пока ничего не напечатал.
4. Пункт API в строке состояния или команда «Arni: Расходы API в USD» показывает серверный журнал. Старые запросы без chatId доступны в общей истории; новые запросы моделей группируются по чату и сохраняются после перезапуска и переключения модели. Изображения смотрите в общей истории аккаунта. reported — есть usage, estimated — сохранён резерв из-за отсутствия подтверждённых токенов; это не окончательная сверка со счётом AWS. Цены в выборе модели указаны за 1 млн входных/выходных токенов.

## macOS: установка и обновления

Старым сборкам без адреса сервера обновлений нужна одна ручная установка: скачать DMG своей архитектуры, закрыть Arni Code и заменить приложение в Applications. Профиль и проекты удалять не нужно. Только после успешной Developer ID подписи, notarization, проверки CLI и контрольных сумм публикуются ZIP/DMG и манифест обновления.

Новая сборка использует stable-канал https://api.arnion.ru. Feed принимает только подписанный и notarized ZIP нужной архитектуры из стабильного GitHub Release, проверяет версию и SHA-256. Повтор той же версии и downgrade не предлагаются. Для следующего выпуска нужно увеличить package.json version и первые два version в package-lock.json; использовать один тег для Windows и обеих macOS-архитектур. Старую или неподписанную сборку feed не предлагает. Установка на реальный Mac ещё требует проверки пользователем.

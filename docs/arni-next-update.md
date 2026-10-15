# Arni Code: model, cost and runtime update

Итоговая памятка на русском: [что реализовано, что узнали, кэширование и готовый видеопромпт](releases/2026-10-15-qwen3-media-and-updates.md). Ниже — журнал выпуска и проверок.

Authorized on 2026-10-15. Preserve the user's source checkout and video project.

- [x] Publish verified Qwen3 models for the existing test account, with current prices, supported input modalities and context limits.
- [x] Use one effective context budget across model metadata, agent runtime and usage indicator; preserve response reserve and compaction headroom.
- [x] Select an available model on the starter project screen and carry it into the first request; remember the last choice.
- [x] Cache eligible repeated Bedrock context and account for cache reads/writes at their distinct tariffs.
- [x] Show actual USD request/chat cost, including historical/restored chats and model changes, with explicit estimates when usage is unavailable.
- [x] Stream long-running shell output and progress without paid model polling. Preserve cancellation and command completion semantics.
- [x] Configure signed macOS DMG/ZIP publication, version/hash/architecture checks in the update feed, native bundle-signature verification and manual bootstrap for older clients.
- [x] Verify targeted regressions, deploy backend, build clients, install the Windows test client after the user closes it, and provide repeatable model-comparison instructions.

Signing dependency: user has Apple Developer membership but no Mac currently. Use GitHub macOS runners; create a CSR on Windows and configure signing/notarization through protected GitHub secrets. Never put signing material or API credentials in source control.

Media comparison: keep existing source/background and scripts unchanged; compare new-model attempts in separate output folders using the same timestamps and quality criteria. Do not claim that a model switch guarantees correct matting.

## Verification and release status

Backend c59e0d0 was deployed and promoted on 2026-10-15. The additive cache migration and seven account-specific Qwen3 grants are applied for srgsdk@yandex.ru; balance remains $2.571136. Qwen3 VL is the account default. Availability and catalog pricing were verified with AWS APIs; paid production inference remains to be verified in the application.

Backend: 13 conversion/update-feed checks, 17 disposable-PostgreSQL billing checks and 9 media checks passed. Targeted client regression tests cover BYOK limits, model selection, terminal lifecycle, progress and cache metrics. No video inputs or scripts were changed.

Windows 1.0.1 (ba48e106949e0258e8e34c73456b317bc5247750) was installed and launched with the existing project on 2026-10-15. Installer SHA-256: 0dc3ca2203ee848271e34e58b268d18ab2e049b3da067a012744dc393602ce29. Installed verification covered 10 core checksums, 37 extension entrypoints, browser defaults, model binding, starter selection, terminal progress and USD usage markers; native CLI reported the expected version, commit and x64 architecture. The previous installation is backed up. An authenticated paid model request in the application remains a user test.

AWS API smoke checks verified tool calls and results for all seven Qwen3 models, image input for Qwen3 VL, and actual Claude cache-write/cache-read usage. These used the audit CLI profile, not production bearer keys; 17 requests were estimated at $0.040291 with configured billing tariffs and did not debit the internal user budget. This is not an invoice reconciliation. Explicit Bedrock prompt caching is enabled for eligible Claude context; no explicit cache support is assumed for Qwen3.

The Developer ID certificate matches the local private key (Team RY26UXEX58, expires 2027-02-01). Signing and App Store Connect team-key secrets are configured in GitHub. Both macOS architectures passed Developer ID verification, Apple acceptance, ticket stapling/validation, Gatekeeper assessment and native CLI checks. The x64 workflow can recover the signed app artifact without recompiling after an Apple network error. A real Mac GUI install/update remains untested.

The update feed compatibility follow-up (backend a2279592963394bd2b4069f6d740d44fa08dd1fc) was deployed and promoted. It preserves the pending commit through Electron's releaseNotes argument, supports a manual-download request for that commit while the running version is older, and supplies native SHA-256/size metadata. Same/newer running versions remain ineligible. See the [Electron event contract](https://www.electronjs.org/docs/latest/api/auto-updater#event-update-downloaded) and the local DarwinUpdateService adapter. The user confirmed Qwen3 models are visible in the installed client.

[Release v1.0.1](https://github.com/ssadkov/arni-code/releases/tag/v1.0.1) was published on 2026-10-15 with 13 assets, each checked against the local SHA-256 and GitHub's asset digest/size. Windows packages ba48e106; both macOS architectures package 40229563 (the later Windows-only AppX fix and CI recovery changes do not change the Mac runtime). Tag-triggered duplicate builds were cancelled to preserve the verified artifacts.

Public api.arnion.ru checks returned valid 200 responses for both architecture ZIPs with matching SHA-256, sizes and pending commits. Direct production-origin checks returned 200 for a pending manual download, and 204 for running versions 1.0.1 and 1.0.2. The RU proxy intermittently timed out during probes; retries succeeded while direct Vercel responses were fast. This is a network limitation observed during verification, not a completed Mac GUI update test.

## Проверка в приложении

1. Начните новый чат в отдельной папке для повторного теста. Сохраните исходное видео и фон без изменений. На стартовом экране выберите Qwen3 VL 235B A22B: из подключённых Qwen только VL видит скриншоты и кадры. Coder Next подходит для кода и текстовых задач, но не принимает картинки, в том числе оставшиеся в истории.
2. Сначала попросите обработать пять секунд, сохранить отдельные кадры и оценить края и зелёный ореол. Укажите горизонтальный 1920×1080, если нужен такой результат. Полный рендер запускайте после просмотра кадров.
3. Раскройте блок команды → Show Output / Focus Terminal. Живой вывод и таймер работают без опроса модели. Процент и приблизительный ETA появляются, если команда печатает счётчик кадров или распознаваемый прогресс ffmpeg. Время без вывода означает лишь, что процесс пока ничего не напечатал.
4. Пункт API в строке состояния или команда «Arni: Расходы API в USD» показывает серверный журнал. Старые запросы без chatId доступны в общей истории; новые запросы моделей группируются по чату и сохраняются после перезапуска и переключения модели. Изображения смотрите в общей истории аккаунта. reported — есть usage, estimated — сохранён резерв из-за отсутствия подтверждённых токенов; это не окончательная сверка со счётом AWS. Цены в выборе модели указаны за 1 млн входных/выходных токенов.

## macOS: установка и обновления

Старым сборкам без адреса сервера обновлений нужна одна ручная установка: скачать DMG своей архитектуры, закрыть Arni Code и заменить приложение в Applications. Профиль и проекты удалять не нужно. Только после успешной Developer ID подписи, notarization, проверки CLI и контрольных сумм публикуются ZIP/DMG и манифест обновления.

Новая сборка использует stable-канал https://api.arnion.ru. Feed принимает только подписанный и notarized ZIP нужной архитектуры из стабильного GitHub Release, проверяет версию и SHA-256. Повтор той же версии и downgrade не предлагаются. Для следующего выпуска нужно увеличить package.json version и первые два version в package-lock.json; использовать один тег для Windows и обеих macOS-архитектур. Старую или неподписанную сборку feed не предлагает. Установка на реальный Mac ещё требует проверки пользователем.

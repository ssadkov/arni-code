# Клиентские пакеты с бюджетом API

Статус на 15 октября 2026: опубликован стабильный [Arni Code 1.0.1](https://github.com/ssadkov/arni-code/releases/tag/v1.0.1), Windows установлен и проверен; macOS arm64/x64 подписаны Developer ID и прошли notarization. [Изменения, проверки и видеопромпт](releases/2026-10-15-qwen3-media-and-updates.md). Исторический prerelease 14 октября приведён ниже отдельно.

Полная модель доступа: [BILLING_AND_ACCESS.md](BILLING_AND_ACCESS.md). Серверный выпуск: [отчёт](releases/2026-10-14-billing-backend.md).

## Пакеты

| Платформа | Файлы | Установка |
| --- | --- | --- |
| Windows x64 | ArniCodeSetup.exe | Запустить user installer; portable ZIP есть в архивном prerelease 1.0.0, не в 1.0.1 |
| macOS Apple Silicon | ArniCode-darwin-arm64.dmg, .zip | Открыть DMG и перенести Arni Code.app в Applications |
| macOS Intel | ArniCode-darwin-x64.dmg, .zip | Открыть DMG и перенести Arni Code.app в Applications |

Новый пакет устанавливается с прежними application ID, bundle ID и каталогами профиля. Удалять профиль/настройки для обновления не нужно. В 1.0.1 Windows собрана из ba48e106, обе macOS — из 40229563: последующее Windows-only исправление AppX и изменения workflow не меняли Mac runtime. Отчёты: build-manifest-win32-x64.json, build-manifest-arm64.json, build-manifest-x64.json и SHA256SUMS-win32-x64.txt / SHA256SUMS-darwin-*.txt; дополнительно update-darwin-*.json для ZIP. Все 13 assets сверены с локальными SHA-256 и GitHub digest/size.

Перед установкой закрыть запущенный Arni Code. На Mac заменить старый Arni Code.app в Applications; на Windows запустить EXE для того же пользователя.

## Автообновление

В 1.0.1 включены stable-канал и updateUrl https://api.arnion.ru. Серверный feed реализован для macOS: выдаёт проверенные ZIP нужной архитектуры только для более новой версии; нативный updater проверяет подпись. Старым сборкам без updateUrl нужна одна ручная установка DMG. Реальный GUI-переход между версиями на Mac ещё требует пользовательской проверки. Windows feed в этой версии не реализован: обновление через EXE вручную.

Для внутренних тестов использовать publish_release=false и отдельный prerelease, не меняя stable/latest. Выпуск 1.0.1 опубликован намеренно как stable/latest после проверок. Если вручную публикуются заранее проверенные assets, остановить дублирующие tag-triggered сборки до их публикации, чтобы они не перезаписали эти файлы.

## macOS и подпись

С 1.0.1 настроены GitHub Secrets для Developer ID и App Store Connect API key. Приложения и DMG обеих архитектур получили Apple Accepted; staple/validate, Gatekeeper, архитектура и CLI проверены. Секреты в документацию не копировать. Текущий сертификат действует до 2027-02-01; для новых выпусков после истечения его нужно обновить. Подробнее о повторах CloudKit и восстановлении signed ZIP — в отчёте 1.0.1.

Только для **архивного ad-hoc prerelease 14 октября** после проверки источника и SHA256 могло требоваться снятие quarantine с установленного приложения:

```bash
xattr -dr com.apple.quarantine "/Applications/Arni Code.app"
```

Не применять команду к Downloads, домашней папке или другим приложениям. Для нового подписанного выпуска не заменять проверку Gatekeeper отключением quarantine. Значения сертификатов и паролей хранить в GitHub Secrets, не в исходниках.

## Проверки перед выдачей

Windows workflow запускает целевые тесты совместимости, собирает production приложение, проверяет встроенные Copilot/Arni/Yandex/VK и точный commit, затем создаёт EXE/ZIP. Отсутствие installer/archive считается ошибкой сборки.

macOS workflow запускает ту же проверку для arm64 и x64 на соответствующих хостах, проверяет архитектуру Mach-O, подпись и формирует DMG/ZIP. Для Apple Silicon используется macos-15, для Intel — macos-15-intel ([GitHub runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)).

После установки проверить: запуск приложения, старый профиль и вход, бесплатную модель для обычного FREE-аккаунта, индикатор денежного бюджета для аккаунта с выдачей, остаток/время сброса и отказ при исчерпанном лимите. Сборка и проверка содержимого пакета не заменяют эти пользовательские проверки.


## Выпущенные пакеты — 14 октября 2026

Внутренний prerelease: [billing-test-2026.10.14](https://github.com/ssadkov/arni-code/releases/tag/billing-test-2026.10.14). Исходный коммит всех приложений: `ee4c1c397273a343ca6288656e91c21be7a723ed`. Исправления упаковщика и отчёт о выпуске находятся в последующих коммитах PR #26; они не меняют исходники упакованного клиента.

- [Windows EXE](https://github.com/ssadkov/arni-code/releases/download/billing-test-2026.10.14/ArniCodeSetup.exe), [portable ZIP](https://github.com/ssadkov/arni-code/releases/download/billing-test-2026.10.14/ArniCode-win32-x64.zip).
- [Mac Apple Silicon DMG](https://github.com/ssadkov/arni-code/releases/download/billing-test-2026.10.14/ArniCode-darwin-arm64.dmg), [ZIP](https://github.com/ssadkov/arni-code/releases/download/billing-test-2026.10.14/ArniCode-darwin-arm64.zip).
- [Mac Intel DMG](https://github.com/ssadkov/arni-code/releases/download/billing-test-2026.10.14/ArniCode-darwin-x64.dmg), [ZIP](https://github.com/ssadkov/arni-code/releases/download/billing-test-2026.10.14/ArniCode-darwin-x64.zip).

Сборки: [Windows](https://github.com/ssadkov/arni-code/actions/runs/38540837474), [Intel Mac](https://github.com/ssadkov/arni-code/actions/runs/38540842482), [повторная Apple Silicon](https://github.com/ssadkov/arni-code/actions/runs/38543783786). В первом Mac run завершилась успешно только Intel job: Apple Silicon тогда отказал на создании DMG с Resource busy и был собран повторно. Для повторной упаковки выбран HFS+, добавлены ограниченные повторы и сохранение ZIP при отказе DMG.

[Проверка готовых Mac-пакетов](https://github.com/ssadkov/arni-code/actions/runs/38544951594): контрольные суммы ZIP/DMG, встроенные расширения, исходный commit, codesign --verify --deep --strict и запуск CLI на каждой архитектуре. Windows ZIP/EXE скачаны локально, SHA256 сверены; portable CLI запущен с отдельными временными каталогами профиля/расширений. Все CLI вывели версию 1.0.0, указанный выше commit и правильную архитектуру.

[SHA256SUMS.txt](https://github.com/ssadkov/arni-code/releases/download/billing-test-2026.10.14/SHA256SUMS.txt) и [billing-build-manifests.json](https://github.com/ssadkov/arni-code/releases/download/billing-test-2026.10.14/billing-build-manifests.json) приложены к релизу.

Полный вход, GUI на Mac и реальный запрос сотрудника после обновления остаются проверками внутреннего теста; они не подменяются успешным запуском CLI.

```text
249aef0c873350e40f4f45cf42845c4fa78163eab4be5fc1a1acb797565886fa  ArniCodeSetup.exe
69e5cdd120df5976ec429e1506d77091e983f54acc66d891268e083ad4cf90b7  ArniCode-win32-x64.zip
44281e47f0aa9c22f5cfe570b0c2e8ae53c5280c1dd68751a2faee778184d3c0  ArniCode-darwin-arm64.dmg
28ee36b78478133f014e67d46b36bf76fea447cc5375e48a12ad47be957eb415  ArniCode-darwin-arm64.zip
ccd1bd7d4f40cf299d29df2db3bb7be9bc27e77469148dc9b61c45a539e9d067  ArniCode-darwin-x64.dmg
19644908bb06dbde3ec6ecac8ff10c6ca514fe0c9cb91bffb5d6547568571086  ArniCode-darwin-x64.zip
```

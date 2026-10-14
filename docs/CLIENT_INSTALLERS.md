# Клиентские пакеты с бюджетом API

Статус: тестовые Windows/macOS пакеты выпущены 14 октября 2026 года. Backend уже выпущен; для старых бесплатных пользователей обновление не обязательно. Новая версия клиента показывает бюджет API, окна 5 часов/7 дней, срок доступа и фактически разрешённые модели.

Полная модель доступа: [BILLING_AND_ACCESS.md](BILLING_AND_ACCESS.md). Серверный выпуск: [отчёт](releases/2026-10-14-billing-backend.md).

## Пакеты

| Платформа | Файлы | Установка |
| --- | --- | --- |
| Windows x64 | ArniCodeSetup.exe, ArniCode-win32-x64.zip | Запустить user installer или распаковать portable ZIP |
| macOS Apple Silicon | ArniCode-darwin-arm64.dmg, .zip | Открыть DMG и перенести Arni Code.app в Applications |
| macOS Intel | ArniCode-darwin-x64.dmg, .zip | Открыть DMG и перенести Arni Code.app в Applications |

Новый пакет устанавливается с прежними application ID, bundle ID и каталогами профиля. Удалять профиль/настройки для обновления не нужно. Все пакеты строятся из одного Git SHA; В текущем релизе SHA256SUMS.txt содержит хеши загрузок, billing-build-manifests.json — версии и хеши встроенных расширений. В следующих workflow builds отчёты имеют отдельные имена для платформы/архитектуры: build-manifest-win32-x64.json, build-manifest-arm64.json, build-manifest-x64.json и SHA256SUMS-win32-x64.txt / SHA256SUMS-darwin-*.txt.

Перед установкой закрыть запущенный Arni Code. На Mac заменить старый Arni Code.app в Applications; на Windows запустить EXE для того же пользователя.

## Автообновление

Автоматическое скачивание/установка новых версий пока не настроено: в product.json нет updateUrl. Публикация новой сборки на GitHub сама по себе не обновляет установленное приложение. Для внутреннего теста используется ручная установка.

Новый тестовый релиз не должен становиться latest стабильного канала. Workflows запускаются с publish_release=false, после успешных сборок их артефакты можно приложить к отдельному prerelease. Текущий стабильный Windows release/latest не меняется.

## macOS и подпись

На 14 октября в GitHub Actions не настроены секреты Apple Developer ID/notarization. Тестовая сборка подписывается ad-hoc и проверяется codesign; она не считается нотариализованной публичной сборкой. Gatekeeper может блокировать запуск. После проверки источника и SHA256 для внутреннего теста можно снять quarantine только с установленного приложения:

```bash
xattr -dr com.apple.quarantine "/Applications/Arni Code.app"
```

Не применять команду к Downloads, домашней папке или другим приложениям. Для обычной публичной macOS-дистрибуции настроить существующий Developer ID + notarization flow в build-macos.yml; значения сертификатов и паролей хранить в GitHub Secrets, не в исходниках.

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

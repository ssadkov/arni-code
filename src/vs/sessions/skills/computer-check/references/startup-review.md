# Interpreting startup evidence

Use the helper snapshot for follow-up questions. Refresh it once only when the user asks for current data or the relevant configuration has changed. Do not recreate the collection in ad hoc shell commands. If a source is unavailable, explain its scope and offer the OS settings; collecting more data must remain filtered and within the user's request.

## Windows

- `data` contains configured StartupCommand entries and boot/logon task states. Counts are records from sources, not distinct enabled apps. Matching names alone do not establish duplicates: different users, scopes and launch mechanisms can have the same name.
- `approval_records` are separate StartupApproved observations, with source `HKCU:Run`, `HKCU:Run32`, `HKCU:StartupFolder` or the corresponding HKLM scope. `code` is only the first byte; the helper emits a conservative `state_hint`. Codes 2/6 give `enabled_hint`, 3/7 give `disabled_hint`; all others, including 1, remain `unknown`. These are registry hints, not a public cross-version contract or proof of actual execution.
- Do not join approval records to inventory records by name across unknown/different scopes. Do not interpret a missing record, absent key or unavailable source as disabled. `approval_coverage` distinguishes `ok`, `bounded`, `absent` and `unavailable`; `bounded` means entries were omitted.
- A process existing now does not prove it started at login. Its absence from the top-eight memory snapshot does not prove it is stopped. A task's Ready state is not a measured startup impact or a security verdict.

Use Settings → Apps → Startup or Task Manager → Startup apps to verify current OS-visible state and any available startup impact. The helper does not inspect executable signatures, shortcut targets, all user accounts, modern packaged startup registrations or all services. Do not classify software as trusted, essential or safe to disable on the strength of its name.

## macOS

`loaded_in_user_domain` means the label appeared in the current user's launchctl domain. It does not establish an enabled Login Item, resource consumption or safety. `not_loaded_in_user_domain` is not globally disabled; system daemons and other domains remain distinct. Plist RunAtLoad/KeepAlive are hints. Use System Settings → General → Login Items & Extensions for the current OS-visible state.

## Recommendations

Keep observation, uncertainty and next action separate. Example: “A launcher has a configured startup entry. Whether it starts at login and its resource cost were not measured. If you do not need it at login, review its switch in Startup apps.” Do not promise a number of GiB saved without a before/after measurement, or call an app the heaviest without comparable measurements.

Explain app purpose from an authoritative vendor source when needed, with uncertainty about the actual installed executable. For example, [NCALayer](https://pki.gov.kz/ru/ncalayer/) is software for electronic signatures, not itself a root certificate required for ordinary TLS; [Disk-O](https://disk-o.cloud/) connects cloud storage, and its name does not make it a Windows system disk utility. Do not infer that sync was enabled intentionally or that a vendor utility is essential for every user.

This skill performs no startup mutations. Suggest the supported OS/app setting as a potential separate action; do not edit StartupApproved or promise a one-byte rollback from this diagnostic workflow.

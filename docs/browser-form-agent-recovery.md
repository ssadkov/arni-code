# Browser form routing regression

## Incident and expected behavior

On 2026-10-25, a local Copilot CLI session using `openrouter/z-ai/glm-5.3-flash`
failed while preparing a Helius x Superteam application. The agent loaded the
unrelated Agentic Engineering Grant skill, fetched only 20,000 characters of
raw HTML, and made ten PowerShell calls searching that incomplete file.
The fetched fragment ended before the questions. The turn ended with
`context_too_large`; its event record contains no compaction events.

A normal request to prepare an application from a supplied form URL must be
enough. Users must not need to name browser tools, exclude unrelated skills,
or diagnose truncated HTML.

## Change

- Universal instructions require a specialized skill to match the requested
  service/program, and route incomplete form reads to rendered inspection.
- With both `openBrowserPage` and `readPage` available in the applied client
  snapshot, the pre-tool hook redirects Google Forms `web_fetch` calls before
  a truncated raw fetch. The existing browser permission and sharing checks
  remain authoritative. Sessions without those tools retain their fallback.
- Marked, structured BYOK context failures preserve the standard Responses
  `context_length_exceeded` code. Other errors keep their previous behavior.
  This repairs error classification; it does not establish that SDK recovery
  or compaction succeeds in a live model session.

## Validation

Patched TypeScript modules were transpiled in memory and loaded into the
existing repository Node unit runner using the prepared development checkout's
dependencies and compiled support modules. No paid model requests were made.

- Tool instructions, prompt registry, Responses translation: **47 passing**.
- Local HTTP BYOK proxy: **23 passing**, including three context-error codes
  and a non-context billing error. The sandbox blocks loopback connections, so
  these local-only tests were run outside the sandbox.
- Copilot session suite: **432 passing, 2 failing**. The same source baseline
  has **430 passing, the same 2 failing**. Both pre-existing failures expect
  `Run Shell Command` where the implementation returns `Команда в терминале`.
  Both new form-routing tests pass, including absent browser tools, other
  document URLs, malformed URLs, and a spoofed Google hostname.
- `git diff --check`: passed.

## Source build and launch, 2026-10-25

The client was rebuilt from all 8,838 TypeScript files, and 2,074 resources
were copied. Both built-in extension compilation/media checks and the Copilot
extension build completed successfully after dependency installation finished.
The fresh output passes 63 tests across tool instructions, prompt registry,
and the local HTTP BYOK proxy.

The build was launched from this worktree with an isolated copy of the current
Arni profile. Its command-center label is `Arni Code — формы d58881bb`; the
native window title is `Agents`. The launcher confirmed CDP readiness, the
main-process log confirmed agent-host startup, and the window process reports
`Responding: true`. The installed application was not replaced.

Startup evidence is in `.build/form-agent-validation/` (ignored): installation,
client, extension and Copilot build logs, `fresh-build-smoke.log`, and
`launch-result.jsonl`. The executable output is from implementation commit
`d58881bb`; this documentation update does not change executable behavior.

A live GLM run on the ordinary application-preparation request remains required
before calling the form workflow end-to-end verified. That run should first
produce a draft, preserve missing-value questions, and avoid submitting the form.

## Startup correction, 2026-10-25

The first launch was incomplete despite the client, standard extensions and
Copilot build succeeding. The standard extension task omitted Arni's three
esbuild extensions: `arni-agent`, `yandex-authentication`, and
`vk-authentication`. Their manifests point to `dist/extension.js`. The missing
Yandex entry point caused activation to fail with `Cannot find module`, followed
by `command 'yandex.signIn' not found` and the generic chat setup failure.

The standard compile/transpile extension tasks now build those three extensions.
Pre-launch repairs missing or empty bundles even when the client `out` directory
already exists. Incremental build readiness also requires those entry points.
The build-fast suite passes **13 tests**, including missing authentication
outputs forcing an extension rebuild; `compile-arni-extensions` also succeeds.

The corrected isolated launch is recorded in
`.build/form-agent-validation/auth-fixed-launch.jsonl`. Its extension-host log
shows Yandex activation without the missing-module failure. Copilot reports
`ConversationFeature: BYOK models available`, and the renderer initializes its
model catalog with GLM 5.3 Flash present. Extension-host startup remains slow in
this development build and briefly triggers unresponsive warnings before
recovering. No successful live model request or browser form run is claimed.

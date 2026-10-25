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

## Contrast and repeated search correction, 2026-10-26

The account label's contrast fix existed only as an uncommitted change in the
older media checkout, so it was absent from this isolated source build. Ported
the specific CSS override: Arni account text and icon use the title-bar text
color in both active and inactive windows, overriding Copilot warning colors.

A later run selected `nvidia/nemotron-3.5-super-vl:free` and made 65 SDK `grep`
calls. The repeated URL query returned file names, not matching URL lines; the
model kept repeating it rather than inspecting the results. The project's
existing documentation contains its public domain. No project-specific domain
is embedded in Arni's global prompt.

The pre-tool hook now denies a third consecutive `grep` with identical arguments
and directs the model to read results. Changed queries, intervening other tools,
and new user turns reset the check. Universal instructions prefer repository
documentation and canonical URL configuration for project website facts.

The two new callback tests pass. The session suite has **434 passing and the
same 2 pre-existing terminal-title localization failures**; prompt and registry
suites have **41 passing**. Changed client modules and the stylesheet were
rebuilt incrementally. Launch evidence is stored in
`.build/form-agent-validation/search-contrast-launch.jsonl`. Actual visual
contrast and model behavior after relaunch still require a live check.

## Restored model and unrelated sign-in correction, 2026-10-26

The next send carried the raw selected identifier
`openrouter/qwen.qwen3-vl-235b-a22b`. At 01:56:39 the renderer rejected its slash
as a foreign participant model and fell back to the default selection. The
protected-resource check then requested Copilot authentication through the
product's Yandex/VK dialog, despite the existing Arni product account. The BYOK
catalog did not finish loading until 01:57:10. Product authentication and
Copilot's GitHub resource authentication are separate requirements.

The session handler now accepts raw host or renderer BYOK identifiers only when
they exactly match an advertised model for the current provider. With signed-out
BYOK operation enabled, an unavailable selection stops with a model-loading
message before interactive authentication, instead of silently selecting a
default model. Known Copilot models retain their existing authentication check.

Six targeted Chromium tests pass, covering restored raw/renderer identifiers,
missing catalog, genuine Copilot authentication, existing namespaced selections,
model configuration, and unrelated vendor identifiers. The older standalone
authentication matrix also exposes an unrelated pre-existing expectation
mismatch for `optionalResourceSignedOutDisabled` (expected true, actual false);
its helper is unchanged by this correction. A missing context-key service in
the contribution test fixture was supplied so these tests can execute.

Changed client modules were rebuilt incrementally. Relaunch metadata is in
`.build/form-agent-validation/restored-auth-launch.jsonl`. A successful paid
model call or complete form run is not claimed by these tests.

## Client tool input and failure-loop recovery, 2026-10-26

Nemotron's later run alternated between two `readFile` calls using `{ path: ... }`.
The extension expects `filePath`, so preparation crashed while dereferencing an
undefined parameter. A similar notebook call failed on `startsWith`. Neither
failure taught the model the required parameter names, and it kept retrying.

The renderer now checks the tool's declared required parameters and top-level
primitive types before invoking the extension. This is a basic object-contract
check, not a replacement for the tool's validation of nested schemas, ranges,
permissions, or file access. Invalid arguments produce a recoverable tool error
listing the required names; no parameter aliases or file paths are guessed.

Per-chat, per-turn tracking cancels a request after three identical failures
from a client tool, including failures repeated with different input paths.
Successful tool work resets the recovery budget, and a new turn gets a fresh
budget. Cancellation is dispatched through the existing turn-cancellation
protocol. Tool error content is preserved, and late calls for the stopped turn
are rejected while cancellation settles. The account/authentication checks and
tool confirmation behavior remain in place.

The complete `AgentHostClientTools` Chromium suite passes **62 tests**, including
the recorded missing-parameter shape, wrong primitive types, three-error loops,
corrected calls, recovery in a new turn after cancellation, execution-error
content, and existing confirmation/delegation behavior. Logs are in
`.build/form-agent-validation/nemotron-tool-recovery-tests-final.log`.

Client output was rebuilt and loaded by reloading the existing Arni window.
A live smoke test uses a new folder containing only a synthetic README with
`https://example.com`. The user approved Arni's workspace trust prompt. In a
fresh chat, the selected and SDK-observed model was
`nvidia/nemotron-3.5-super-vl:free`. Its first `readFile` call provided `filePath`
but omitted `startLine` and `endLine`; the renderer returned the required names.
The model corrected its next call to lines 1–200, read the file successfully,
and answered with the correct URL and Dev plan for one year. The session became
idle without session errors or file edits. Evidence is in the ignored
`.build/form-agent-validation/nemotron-live-smoke.json` (SDK session
`93c58564-c25a-4211-952d-fdc34f1fa6c7`). This verifies live recovery from the
argument error, rather than only a unit-test replay. The backend routing ledger
was not independently audited.

The synthetic read does not establish the complete Google Form workflow. No
form was submitted. The Qwen `context_too_large` failure remains a separate
unresolved issue; continuing the old oversized conversation is not a clean
model comparison.

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
listing the required names; file paths and missing line ranges are not guessed.

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

## Catalog outage, provider labels, and explicit read ranges, 2026-10-26

The next launch retained the Yandex account, but its Copilot extension log at
02:49:53 recorded HTTP 502 from `/auth/exchange`. The client stopped trying
configured backend candidates after any HTTP response, including gateway
errors. The empty model picker then presented the upstream Copilot sign-in
action. The catalog eventually recovered at 02:50:26.

Token exchange now tries configured backups after network failures, a ten-second
timeout, HTTP 5xx, 408, or 429. Temporary outages preserve the cached token;
explicit 401/403 rejection clears it and does not try another origin. Logs
record status rather than response bodies. Catalog requests also have a
ten-second timeout before trying the next source. When an Arni product session exists,
the empty picker explains that Arni models are unavailable instead of offering
Copilot sign-in. Model names show `Amazon Bedrock` or `OpenRouter` from the
backend's `arni_provider` field; the shared adapter's internal ID prefix does
not identify the inference provider.

The real form session `5e59b826-d225-4d27-9917-1289c67f69c1` opened the browser
and read the user profile, then stopped at 02:54:42 after three invalid reader
calls. Nemotron supplied `filePath` and `view_range` rather than `startLine` and
`endLine`. For the bundled legacy `copilot_readFile` schema only, the client now
translates an explicit two-element, positive, ordered integer range. Canonical
parameters take precedence; invalid/unbounded ranges and third-party tools are
unchanged. File-access and confirmation checks still apply.

Validation: provider/authentication unit suite **26 passing**, model-picker
Chromium suite **101 passing**, client-tool Chromium suite **64 passing**,
including replay of the observed range arguments. Logs are under
`.build/form-agent-validation/`. This range replay is not a new complete live
form run, and it does not resolve the separate Qwen context-limit failure.

## Form workflow limits and budget-error propagation, 2026-10-27

Audit of SDK session `28ba6f72-f920-4542-b98f-5d776afdf3ae` and the production
ledger confirmed Bedrock Qwen3 VL. Its last cycle made 37 successful requests
costing $1.049759 while reading documents, without opening the form or producing
a draft. The automatic `apply-grant` skill targeted a different program and
triggered telemetry/export setup. Six subsequent HTTP 403 insufficient-budget
responses were exposed to the SDK as 502; those rejected attempts had no new
usage charges. Internal budget was topped up separately at the user's request.

The shared fetcher used to interpret every 401/403 as an expired Copilot token,
discarding the structured provider error. For BYOK only, permanent request or
account errors now preserve HTTP status and the error body before that branch.
Provider classification recognizes confirmed structured account/context codes;
the loopback proxy preserves budget codes in a non-retryable 400 envelope.
Ordinary Copilot authentication and transient upstream retries retain their
existing paths. A fetcher regression test checks one call and no token reset.

`FormTaskGuard` applies to a new user message asking to prepare/fill an
application and containing an HTTPS Google Form link, when both browser tools
are present. It requires successful open/read of that target page before
repository reads, rejects automatically selected skills and shell setup for
this task, and allows ten reader/search calls per turn. A skill explicitly
named by the user is retained. Three ignored guard corrections stop the turn
with a visible explanation; they do not authorize browser sharing, file access
or submission. A new ordinary coding message clears this form-specific state.
This orders source inspection; it does not semantically validate the extracted
questions or guarantee a model-written draft.

Tests: fetcher/provider/endpoint **81 passing**, loopback proxy **24 passing**,
prompt instructions **15 passing**. Full session suite: **438 passing**, with
the same two existing English-vs-Russian terminal-title expectation failures;
all four added form tests pass. The recorded bad trace is stopped at its fourth
tool request by the new guard, before its document-reading cycle. Logs and replay
evidence are in `.build/form-agent-validation/*20261027*`. No paid inference was
used for these checks. A new live form draft still needs user testing.

### Repeat test

1. Use the updated window and create a **new chat** in the actual Yield AI
   project, not in the Arni source checkout or the old oversized conversation.
2. Select `Amazon Bedrock · Qwen3 VL 235B A22B` so the comparison keeps the same
   model. Wait until the model is displayed before sending.
3. Send a normal request: "Подготовь черновик заявки по этой ссылке для Yield AI.
   Факты возьми из проекта, контакты — из «Моих данных». Выбранный план: Dev plan
   for 1 year. Покажи ответы с источниками, недостающее спроси. Форму пока не
   заполняй и не отправляй." Append the Helius × Superteam Google Form URL.
4. Expect browser open/read before repository gathering, targeted source reads,
   and then a draft or a specific access blocker. A telemetry question, transcript
   export, another grant's checklist, or continued sequential reading is a
   regression. Report the chat's result for log/ledger review; do not repeatedly
   continue the old run. Form submission remains a separate user-approved step.

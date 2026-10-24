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

The installed application was not replaced. A full product build and a live
GLM run on the ordinary application-preparation request are still required
before calling this an end-to-end verified fix. That run should first produce
a draft, preserve missing-value questions, and avoid submitting the form.

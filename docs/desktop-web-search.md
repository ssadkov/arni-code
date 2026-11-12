# Desktop web search

Arni Code exposes `search_web` as a shared Agent Host server tool, including for free and paid Arni models. It sends a trimmed `query` of at most 300 characters and returns at most five HTTP(S) links with titles and snippets. Titles and snippets are untrusted website content; the agent should cite the returned URLs and read the actual pages when snippets are insufficient or freshness matters.

## Authentication and requests

The workbench reads the existing Yandex, VK or Google sign-in session. The internal `arni.exchangeWebSearchSession` command performs `POST /api/auth/exchange` in the built-in extension's Node host, avoiding renderer CORS. Only the exchanged Arni JWT is published to Agent Host under `https://api.arnion.ru`; OAuth access tokens are not published to model providers or search tools.

Account changes revoke the previous JWT before an exchange. A generation check discards late replies after sign-out, account changes or disposal. The session is republished after Agent Host restarts and refreshed every 12 hours; temporary exchange failures retry after 30 seconds.

Search calls `POST /api/web-search` with `Authorization: Bearer <Arni JWT>` and only `{ "query": "..." }`. Origins are tried in this order:

1. `https://api.arnion.ru`
2. `https://arni-backend.vercel.app`

Only network errors and HTTP 503 try the second origin. HTTP 401 asks for another sign-in; HTTP 403 reports that the account cannot use search. Empty `results` is a valid search response. Malformed responses are errors and are not silently presented as empty results. Backend and transport response bodies are not included in user-facing errors.

Exa credentials stay on the server. No client API key or extra MCP setup is needed. Arni model sessions exclude the CLI's separate `builtin:web_search`, which requires GitHub Copilot authorization, and use the shared `search_web` instead.

## Verification

Focused tests cover the query boundary, URL filtering, five-result limit, origin fallback, permanent authorization failures, sanitized errors, Yandex/VK/Google exchange, late exchange after sign-out, and Agent Host restart. The launcher tests cover disabling Copilot-hosted search for Arni models.

For a live check, use an isolated signed-in profile, create a new chat on an Arni model, and ask: `Use search_web to find official Aptos Move documentation. Return 2 titles and URLs. Do not run commands or edit files.` Confirm a `search_web` call succeeds and the final reply includes returned source links. Test another request after restarting Agent Host and ensure sign-out removes search access.

The backend contract is documented in the sibling repository's `docs/web-search.md`. Desktop source changes and a successful extension build do not by themselves publish a new desktop release.

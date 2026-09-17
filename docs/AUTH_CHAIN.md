# Yandex → JWT → Chat completion chain

The Arni backend is **not in this repository**. The desktop client talks to a separately deployed Next.js app at `https://arni-backend.vercel.app`.

The site origin (`GET /`) currently serves the default Next.js “Create Next App” landing page. That is **not** proof the backend is a stub: the API routes below are live and return JSON. Treat `/` as an unfinished UI, not as the contract.

## Sequence

```
Arni Code desktop
  1. Yandex OAuth + PKCE  →  oauth.yandex.ru
  2. Store Yandex access/refresh tokens in SecretStorage
  3. POST /api/auth/exchange  { provider, token }  →  Arni JWT
  4. POST /api/chat/completions  Authorization: Bearer <JWT>
       → backend proxies to OpenRouter
```

Two chat surfaces share this chain:

| Surface | Extension | Default in product.json |
| --- | --- | --- |
| Arni sidebar webview | `arnion.arni-agent` | `completionsMenuCommand` / sidebar view `arni.chatView` |
| Copilot Chat → OpenRouter BYOK | `GitHub.copilot-chat` | `defaultChatAgent.chatExtensionId` |

## Client endpoints

`arni.backendUrl` is the **origin** (default `https://arni-backend.vercel.app`). The client appends `/api`. Setting the value to `…/api` is also accepted and is not doubled.

### 1. Yandex OAuth (browser + loopback)

- Authorize: `GET https://oauth.yandex.ru/authorize`
  - `response_type=code`
  - `client_id` from `yandex.clientId` (default `5255b6b242694d51b97d71483148321f`)
  - `redirect_uri=http://127.0.0.1:<ephemeral-port>/callback`
  - `scope=login:info login:email` (plus `login:avatar` when scopes were empty)
  - `state` (CSRF)
  - `code_challenge` / `code_challenge_method=S256`
- Token: `POST https://oauth.yandex.ru/token` (`application/x-www-form-urlencoded`)
  - authorization code: `grant_type=authorization_code&code&client_id&code_verifier&redirect_uri` (`client_secret` only if configured)
  - refresh: `grant_type=refresh_token&refresh_token&client_id` (`client_secret` only if configured)
- Profile: `GET https://login.yandex.ru/info?format=json` with `Authorization: OAuth <yandex-access-token>`
- Sessions: SecretStorage key `yandex.auth.sessions`

The Yandex OAuth app must allow loopback redirects on `http://127.0.0.1:<port>/callback`. A random port is used; confirm in the Yandex OAuth console that desktop/loopback redirects are permitted.

### 2. JWT exchange

```
POST {arni.backendUrl}/api/auth/exchange
Content-Type: application/json

{"provider":"yandex","token":"<yandex access token>"}
```

Probed live (2026-09-14):

| Request | Status | Body |
| --- | --- | --- |
| `POST` `{}` | 400 | `{"error":"Missing provider or token"}` |
| `POST` `{"provider":"google","token":"x"}` | 400 | `{"error":"Unsupported provider"}` |
| `POST` `{"provider":"yandex","token":"probe"}` | 401 | `{"error":"Invalid Yandex token"}` |
| `GET` | 405 | empty (`Allow: OPTIONS, POST`) |

Expected success body (client reads the first present field): `{ "token": "<jwt>" }` or `access_token` / `jwt`.

Arni Agent caches the JWT in SecretStorage key `arni.jwtToken` as JSON `{ token, expiresAt }`. `expiresAt` comes from the JWT `exp` claim when present, otherwise a 45-minute fallback TTL. The client re-exchanges when the token is missing, malformed, or within 5 minutes of expiry. The cache is also cleared on Yandex sign-out and on chat HTTP 401.

### 3. Chat completion

```
POST {arni.backendUrl}/api/chat/completions
Content-Type: application/json
Authorization: Bearer <arni JWT>

{
  "model": "<arni.modelId, default qwen/qwen-2.5-coder-32b-instruct>",
  "messages": [{ "role": "user", "content": "<prompt>" }],
  "stream": true
}
```

Probed live (2026-09-14):

| Request | Status | Body |
| --- | --- | --- |
| `POST /api/chat/completions` no auth | 401 | `{"error":"Unauthorized"}` |
| `POST /api/chat/completions` `Bearer probe` | 401 | `{"error":"Invalid Token"}` |
| `POST /chat/completions` (no `/api`) | 404 | Next.js HTML |
| `POST /api/messages` | 404 | Next.js HTML |
| `GET /api/chat/completions` | 405 | empty |

Streaming responses are OpenAI SSE (`data: {choices[0].delta.content}…` / `data: [DONE]`).

## Confirmed mismatches (historical)

These were true before the fixes in this change:

1. **Chat path:** Arni Agent and Copilot called `{origin}/chat/completions` (404). Backend is `{origin}/api/chat/completions`.
2. **Copilot JWT not attached:** exchange stored JWT on `model.apiKey`, but the endpoint was created with `model.configuration?.apiKey` (empty / OpenRouter key).
3. **Anthropic `/messages`:** Copilot routed `anthropic/*` to `{origin}/api/messages`, which does not exist on the Arni proxy.
4. **CSRF hang:** a `state` mismatch rendered an error page and then waited for the 5 minute loopback timeout.
5. **No refresh:** Yandex `refresh_token` / `expiresAt` were stored and never used.
6. **Inverted `trustedExtensionAuthAccess`:** object keys must be **provider ids**, values **extension ids**. It was stored as `{ "arnion.arni-agent": ["yandex", "github"] }`.
7. **Stale JWT after sign-out:** `arni.jwtToken` was returned even with no Yandex session.

## Failure modes

| Symptom | Likely hop | What to check |
| --- | --- | --- |
| Browser error, editor still waiting | Loopback CSRF / timeout | Callback URL, `state`, Yandex redirect URI |
| “Could not authorize with the Arni backend” | JWT exchange | Yandex token valid; `POST /api/auth/exchange` not 401 |
| Chat 404 HTML | Wrong path | Must be `/api/chat/completions`, not `/chat/completions` |
| Chat 401 `Invalid Token` | JWT attach | `Authorization: Bearer` is the Arni JWT, not the Yandex OAuth token |
| Chat 401 `Unauthorized` | Missing header | No `Authorization` |
| Chat 402 | Entitlement / balance | Backend-side quota (not implemented in this repo) |
| Copilot prompts “allow access to Yandex ID” | Trust list | `product.json` `trustedExtensionAuthAccess.yandex` |

Workbench Chat setup with Yandex (`ChatSetupStrategy.SetupWithYandexProvider`) signs in via `yandex.signIn` and then calls `ChatSetupController.setup({ skipSignIn: true })` so the bundled `GitHub.copilot-chat` extension is installed/enabled without GitHub Copilot entitlement.

There is no `/api/entitlement` route on the deployed backend. GitHub Copilot entitlement is a separate chain and is not required for the Arni sidebar.

## Manual verification (needs a real Yandex account)

The following cannot be completed in CI or with a synthetic token.

1. **OAuth hop.** Command Palette → “Arni: Sign In with Yandex ID”. Browser opens `oauth.yandex.ru`. After consent, loopback shows success and the editor shows the account name. Time this: it must not sit for minutes on a failed callback.
2. **Redirect URI.** In the Yandex OAuth console, confirm the app accepts `http://127.0.0.1:<port>/callback` (or equivalent loopback policy). If authorize returns `invalid_request` / redirect mismatch, the client never reaches token exchange.
3. **JWT hop.** After sign-in, send a message in the Arni sidebar. In a proxy or backend logs, confirm:
   - `POST /api/auth/exchange` with `{provider:"yandex", token:<yandex access token>}` returns 200 and a JWT.
   - `POST /api/chat/completions` with `Authorization: Bearer <jwt>` (not the Yandex token).
4. **Refresh hop.** Either wait until `expires_in` or temporarily shorten expiry in a debug build. `getSessions` should `POST /token` with `grant_type=refresh_token` and keep chat working without a new browser login.
5. **Sign-out hop.** “Arni: Sign Out from Yandex ID”, then send a chat message: it must prompt Yandex again and must not reuse the previous JWT.
6. **Copilot Chat (optional).** Pick an OpenRouter model in Copilot Chat while signed into Yandex. Same `/api/chat/completions` request; no second consent prompt (trusted access). Anthropic model IDs must still hit `/api/chat/completions`, not `/messages`.
7. **Yandex app secrets.** Production should not rely on the in-repo default `yandex.clientId` without confirming it is the intended public client and that PKCE-without-secret is allowed.

## Related code

- `extensions/yandex-authentication/src/yandexAuthProvider.ts`
- `extensions/yandex-authentication/src/loopbackServer.ts`
- `extensions/arni-agent/src/webview/chatPanel.ts`
- `extensions/arni-agent/src/arniBackend.ts`
- `extensions/arni-agent/src/providers/arniProvider.ts`
- `extensions/arni-agent/src/providers/providerFactory.ts`
- `extensions/copilot/src/extension/byok/vscode-node/openRouterProvider.ts`
- `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner.ts`
- `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupController.ts`
- `product.json` (`trustedExtensionAuthAccess`, `defaultChatAgent.chatExtensionId` = `GitHub.copilot-chat`)

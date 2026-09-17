# Arni Code — Launch and pricing (proposal)

Status: **idea, not implemented.** Captured 2026-09-17 after the first BYOK agent sessions
through `arni-backend` → OpenRouter.

This is the launch tariff sketch for the first ~100 users. The editor stays usable
when AI quota is exhausted (same shape as Cursor Hobby).

---

## How Cursor does it (reference, 2026)

Cursor does not sell unlimited frontier Agent. It sells **a taste, then capacity**.

| Stage | What the user feels |
|---|---|
| **Hobby** (forever, no card) | Full IDE. Agent / Chat / Tab exist but are tightly capped. Default is cheap Auto, not Claude. Enough to poke, not to work every day. |
| **Pro trial** (~7 days) | Real Agent so the user hits the “it writes files” moment. Then pay or drop back to Hobby. |
| **Pro $20/mo** | Two pools: generous Cursor-owned models (Composer / Grok) + about $20 of third-party models (Claude / GPT). Then on-demand or wait for the monthly reset. |
| **Pro+ / Ultra** | 3× / 20× Agent capacity. Daily Agent users often land at $60–100/mo total, not $20. |

The IDE never locks. Only AI stops. Unlimited Auto is gone; Auto is a router with a rate card.

Arni should copy this psychology, not Cursor’s dollar amounts. We do **not** have a cheap owned model pool. Our “Auto” is a **shared OpenRouter `:free` bucket**.

---

## What we actually have today

Two independent meters. Confusing them caused the 2026-09-17 outage (`402` then `429`).

| Layer | Whose | What it gates | Live numbers (this key) |
|---|---|---|---|
| Arni `User.tokenBalance` | **per user** | Backend refuses FREE users at `<= 0` with `402 Insufficient tokens`. Decremented by prompt+completion on **every** completion, including `:free`. | Admin credit; default grant was 100k and Nemotron Ultra burned it in one evening. |
| OpenRouter `:free` daily | **the shared API key** | `429 free-models-per-day`. Resets 00:00 UTC (05:00 UTC+5). | 50 RPD with no qualifying purchase; **1000 RPD** after a one-time credit purchase. **20 RPM** either way. |
| OpenRouter paid models | account $ | No 50/1000 cap. Billed per token (DeepSeek, Haiku, …). | Already spent ~$0.63 on this key before the `:free` daily cap. |
| Upstream provider pool | NVIDIA / Poolside / … | Extra `429` with `limit_source=upstream_provider_shared_pool`. Independent of the 50/1000. | Poolside Laguna `:free` 429 the same evening Nemotron Ultra worked. |

Qualifying purchase: the live 429 asked for **$5** to unlock 1000 RPD; OpenRouter FAQ still says **$10**. Buy **$10** once so fees do not leave the account under the threshold. It is lifetime: the 1000 RPD ceiling stays even if the credit balance later sits near zero.

**Do not farm extra OpenRouter accounts or keys.** Their docs: *“Making additional accounts or API keys will not affect your rate limits, as we govern capacity globally.”* Extra keys on the same account share the counter. Extra accounts are against their rules and still share capacity.

One agent turn with tools = **one HTTP request**. A calculator-style task was 4–8 requests. A real edit session is often 15–30. So “1000/day” is not 1000 chat messages.

---

## Proposed products

Default agent model for Hobby remains `nvidia/nemotron-3-ultra-550b-a55b:free` (native `tool_calls` proven). Fallback `:free` picks: `cohere/north-mini-code:free`, then `nex-agi/nex-n2.5-mini:free`. Do not lean on `poolside/laguna-s-2.1:free` until the shared Poolside pool is healthy.

### Hobby / trial (no card, Yandex login, forever)

Goal: **finish one real task**, not replace Cursor for a month.

- Editor always works.
- Agent only on `:free` models.
- **15 agent requests / user / UTC day.** That is 1–2 short tasks (create + one edit), not a sprint.
- **Global stop** when OpenRouter `free_model_daily_requests.remaining` hits 0: clear copy *“Free models are done for today. Back at 05:00 (UTC+5), or upgrade.”*
- Keep `tokenBalance` as a second fuse (Ultra context is expensive in *our* units even when OpenRouter charges $0).
- When the personal 15 or the global 1000 is hit, do not retry `:free` in a loop (that is how Laguna 429 stacked).

First 100 registered users, if ~30 actually Agent in a day × 15 requests ≈ **450 of 1000**. If all 100 show up the same day, the global pool dies by afternoon — hence the per-user 15 is mandatory.

### Optional 7-day Pro trial (when we can spend a few dollars)

Mirror Cursor’s aha week. Route Hobby-trial users to **DeepSeek** (paid, no `:free` RPD). They see speed and no 429. Cost to us is cents; conversion is the point. Skip this until there is a card on OpenRouter and a tiny included-$ budget.

### Pro (paid)

- Default **DeepSeek** (or equivalent cheap paid). Optional Haiku / frontier in the picker.
- **Does not consume** the shared `:free` 1000.
- Billed via Arni plan / `tokenBalance` (or a dollar allowance later). We pay OpenRouter for tokens.
- When included usage is gone: wait for the billing period, or on-demand, or keep Hobby `:free` at the 15/day cap.

### What we will not ship

- Unlimited Nemotron on a shared key.
- One user able to drain the day’s 1000.
- Extra OpenRouter accounts as a scaling strategy.
- Using Laguna `:free` as the advertised default while its upstream pool 429s.

---

## Capacity cheat sheet (after $10, 1000 RPD + 20 RPM)

| Mix | Fits in 1000/day? |
|---|---|
| 100 signed up, ~10 actually chatting, short tasks | Yes |
| 100 DAU × 1 short task (~8 req) | Tight (~800) |
| 100 DAU × real Agent (~20 req) | No (~2000) |
| Concurrent | 20 RPM for the whole product. Ultra is slow, so RPM rarely binds. North Mini / Laguna can. |

Upstream 429 can still kill a model that is “inside” the 1000.

Paid models are the real scale path. `:free` is the trial kettle.

---

## Backend work this implies (not done)

Today `POST /api/chat/completions` only checks `tokenBalance` and proxies. It does not know about OpenRouter RPD.

1. Buy $10 OpenRouter credits on the production key (ops, not code).
2. Cache `GET https://openrouter.ai/api/v1/key` → `free_model_daily_requests`.
3. Per-user daily counter of `:free` completions (15). Reset with UTC day, same as OpenRouter.
4. If user plan is FREE and (personal cap or global remaining is 0): `429` with a stable Arni error code, not a raw OpenRouter blob.
5. Pro / 7-day trial: rewrite `body.model` away from `:free` (DeepSeek) or reject `:free` and tell the client to switch.
6. Do not decrement `tokenBalance` into large negatives on `:free` without a floor; optional: skip decrement when `model` ends in `:free` *or* keep decrementing as a fairness tax — decide before coding. Current code charges both.

Admin credit (`POST /api/admin/users/:id/credit`) stays the manual fuse for `tokenBalance`. It does **not** refill OpenRouter RPD.

---

## Copy (user-facing, later)

- Hobby exhausted, personal: “You used today’s 15 free agent requests. Tomorrow, or Pro.”
- Hobby exhausted, global: “Free models are at capacity for everyone until 05:00. Pro uses paid models and is not in this queue.”
- Provider 429: “This free model is busy. Try Nemotron Ultra or North Mini, or Pro.”

Do not mention OpenRouter, keys, or “add $5 credits” in the product UI.

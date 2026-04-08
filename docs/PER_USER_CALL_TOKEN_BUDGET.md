# Per-user call token budget — deployment plan

This document is for the **lead developer** preparing production: assigning a **token budget per registered user** so outbound calls cannot consume more Realtime/API usage than you allocate. It ties together what this repo already does, what is **not** enforced yet, and a **phased schedule** to implement and operate the feature safely.

---

## 1. What you are protecting

- **Call tokens** here mean **usage units** reported for Realtime calls (e.g. `input_tokens`, `output_tokens`, `total_tokens` merged into call task payloads and shown on the **Tokens** tab). The same ideas apply if you also charge **per call** or **per minute**—pick one primary unit and enforce it consistently.

- **Users must never be the source of truth** for “how much is left.” The browser can be modified. Enforcement must happen on **servers you control** (your API layer, the **call backend** that runs `POST /api/calls`, or both).

---

## 2. Current behavior in this repository (baseline)

| Area | What exists today |
|------|-------------------|
| **Identity** | Supabase Auth is supported on the Auth page when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set; `CallBackendAuthContext` sends `session.access_token` as `Authorization: Bearer` for chat/call APIs. `DemoAuthContext` still uses a **fixed demo user id** for dashboard data—**for production you should align dashboard `userId` with `auth.users` / Supabase session** so tasks and budgets attach to the real account. |
| **Users in DB** | `supabase/schema.sql` defines a `users` table (`id`, `email`, timestamps). There are **no** token budget columns in the baseline schema. |
| **Tasks / usage display** | Call-related tasks are stored per `user_id`; token fields are merged from the call backend into task `payload` (see `TokensView`, `Dashboard` usage hooks). |
| **Global “budget” UI** | `TokensView` reads **`VITE_MONTHLY_TOKEN_BUDGET`** (optional env)—that is a **single app-wide display cap**, not per-user assignment. |
| **Call authentication** | Node (`server/index.js`) and Python (`app/services/call_placement.py`) can use the request Bearer token, **`CALL_API_TOKEN`**, or `CALL_BACKEND_ALLOW_NO_AUTH`—see `.env.example`. That controls **who may call the call backend**, not per-user consumption limits. |

**Gap:** Nothing in this repo automatically **assigns** a per-user cap or **blocks** a call when that user’s accumulated usage exceeds the cap. You need to add that policy in your **authoritative** service (recommended: **call backend** + optional **your** backend).

---

## 3. Target architecture (recommended)

1. **Source of truth for “allowed usage”**  
   Store per user (keyed by **Supabase `auth.users.id`** or your `public.users.id` if kept in sync):
   - `token_budget_total` (or monthly allowance), and/or  
   - `tokens_consumed` (running total), and/or  
   - `period_start` if you reset monthly.  

   Implement as columns on `public.users`, a dedicated `user_call_entitlements` table, or metadata you manage in an admin tool.

2. **Source of truth for “used usage”**  
   - **Minimum:** Sum usage from **your** persisted call tasks / events (already keyed by `user_id` when wired to real auth).  
   - **Stronger:** The **call backend** increments usage atomically when a call runs or ends (same pattern as `usage_update` / `call_ended` in the live transcript flow).

3. **Enforcement points (pick at least one; two is better)**  
   - **Before starting a call:** Reject `POST /api/calls` (or your wrapper) if `consumed + estimated >= budget`.  
   - **During the call:** The Realtime/call backend should respect its own `limit_tokens` / quota (your separate service may already expose this; the dashboard listens for `quota_warning`).  
   - **After the call:** Reconcile totals from final usage payload so accounting matches invoices.

4. **Admin workflow**  
   As lead developer, you need a **safe** way to set budgets (SQL in Supabase, internal admin API, or Supabase Dashboard with RLS-aware policies). **Do not** expose unrestricted writes to budgets from the client.

---

## 4. Phased schedule (what to do and when)

Use this as a checklist; adjust calendar to your release train.

### Phase A — Prerequisites (before coding entitlements)

| Step | Action |
|------|--------|
| A1 | **Production Supabase:** Enable Auth, confirm email settings, and ensure `public.users` rows are created/linked for each signup (your backend may already use `ensure_user(user_id)`—verify in deployment). |
| A2 | **Align user ids:** Replace or extend `DemoAuthContext` so the dashboard uses **`auth.uid()`** from Supabase when configured, so `user_id` on tasks and future budget rows matches real accounts. |
| A3 | **Decide units:** Token count vs. USD credits vs. “N calls per month.” The Tokens tab is token-oriented; product/legal may drive the unit you sell. |

### Phase B — Data model (Week 1)

| Step | Action |
|------|--------|
| B1 | Add a migration (new file under `supabase/migrations/`) for budget columns or an `user_call_entitlements` table. Include `updated_at` and consider a **check constraint** (`consumed <= budget`) if both live in one row. |
| B2 | Add **RLS** so authenticated users can **read** their own budget/usage; only **service role** or **edge function** can **write** admin assignments. |
| B3 | **Default for new signups:** trigger or app logic setting an initial budget (e.g. 0 until you approve, or a starter allowance). |

### Phase C — Enforcement (Week 2–3)

| Step | Action |
|------|--------|
| C1 | **Call backend:** On each `POST /api/calls`, validate JWT, resolve user id, load budget, compare to consumed (+ optional buffer). Return **403** with a clear message when over budget. This is the **strongest** place to enforce if that service owns Realtime. |
| C2 | **Optional gateway:** If the chat server (`server/index.js`) or Python API fronts calls, add a **pre-check** there too so abuse never reaches the call backend. Keep logic in one module to avoid drift. |
| C3 | **Idempotency:** If a call fails after reservation, roll back or reconcile so users are not charged twice or stuck “reserved.” |

### Phase D — Product & ops (Week 3–4)

| Step | Action |
|------|--------|
| D1 | **UI:** Replace or supplement `VITE_MONTHLY_TOKEN_BUDGET` with **per-user** values from your API so the Tokens tab shows *their* allowance and remaining amount. |
| D2 | **Admin:** Script or internal page to **set budget** by email/user id; audit log who changed what. |
| D3 | **Alerts:** Email or Slack when a user hits 80%/100% of budget; optional monthly reset job if you use calendar months. |

### Phase E — Launch verification

| Step | Action |
|------|--------|
| E1 | Test: user at 0 budget cannot start a call; user under budget can; over-cap mid-call behaves as defined (hard stop vs. soft warning). |
| E2 | Load test: concurrent calls do not allow **overspend** due to race conditions (use DB transactions or atomic counters). |
| E3 | Document **support runbook:** how to grant more tokens, handle disputes, and read usage in Supabase. |

---

## 5. Configuration reference (this repo)

- **Call backend URL / auth:** `.env.example` — `CALL_BACKEND_URL`, `CALL_API_TOKEN`, `CALL_BACKEND_ALLOW_NO_AUTH`.  
- **Global display-only budget (not per-user):** `VITE_MONTHLY_TOKEN_BUDGET`, `VITE_CREDIT_BALANCE_USD`.  
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` for server-side writes; frontend uses `VITE_SUPABASE_*`.

---

## 6. Security reminders

- **Never** trust client-side totals for enforcement.  
- **Service role** keys must stay on the server; use RLS for client reads.  
- If you mint custom JWTs for the call backend, validate issuer/audience and short TTL; rotate `CALL_API_TOKEN` if leaked.

---

## 7. Summary

| You want | Do this |
|----------|---------|
| Assign tokens per registered user | Store budget per `user_id` in Supabase (migration + admin process). |
| Prevent unlimited use | Enforce at **call start** on the **call backend** (and optionally your API proxy); use atomic updates. |
| Fair accounting | Reconcile with usage payloads already flowing into call task `payload` / live usage socket. |
| Operable rollout | Follow Phases A–E; fix demo vs. real `user_id` before relying on per-user data. |

This file is a **planning and runbook** artifact; implementation details will live in migrations, your call backend, and small dashboard/API changes when you execute Phase B–D.

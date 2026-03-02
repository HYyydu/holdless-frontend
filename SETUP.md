# Holdless-main: Step-by-step setup guide

Follow these steps from a terminal. All commands assume you are in the project root: `holdless-main`.

---

## 1. Open the project and go to its folder

```bash
cd /Users/yuyan/Downloads/holdless-main
```

---

## 2. Install dependencies

```bash
npm install
```

---

## 3. Create and edit `.env`

Create a `.env` file (copy from the example, then edit with your real values):

```bash
cp .env.example .env
```

Edit `.env` in your editor. **Minimum for chat + calls via GPT-4o Realtime backend:**

| Variable | What to set |
|----------|-------------|
| `OPENAI_API_KEY` | Your OpenAI API key (required for chat) |
| `CALL_BACKEND_URL` | **Must be a separate service** that implements `POST /api/calls` (and `GET /api/calls/:id`). Not this chat server. Example: `http://localhost:4000` when the call backend runs on port 4000. |
| `CALL_API_TOKEN` | **Optional.** See [Call backend auth](#call-backend-auth) below. |

Optional:

- `GOOGLE_PLACES_API_KEY` – for “search nearby X” in chat.
- `CHAT_SERVER_PORT` – default `3001` (holdless backend).
- `VITE_API_TARGET` – set to `3001` so the frontend proxy sends `/api` to the Node chat server (required for chat + calls and for call-backend sign-in proxy).
- `VITE_SUPABASE_*` – only if the frontend uses Supabase auth/data.

**Example `.env` (minimal for Realtime calls with per-user sign-in):**

```env
OPENAI_API_KEY=sk-proj-xxxx
CHAT_SERVER_PORT=3001
CALL_BACKEND_URL=http://localhost:4000
# No CALL_API_TOKEN – frontend signs in to call backend and sends JWT with each request
```

### Call backend auth

**If your call backend has no `/api/auth/signin` and your Auth page has no sign-in form** (e.g. it only shows “No account needed” and “Go to Dashboard”):

- **Option 1 – Fixed API key:** Set `CALL_API_TOKEN` in `.env` to whatever your call backend accepts (e.g. an API key). The Node server sends it as `Authorization: Bearer <value>` on every call request. No app sign-in needed.
- **Option 2 – No auth:** If your call backend does not require authentication, set `CALL_BACKEND_ALLOW_NO_AUTH=true` in `.env`. The Holdless server will then call the backend without sending an `Authorization` header. **You must also configure the call backend itself** (the app at `CALL_BACKEND_URL`, e.g. port 4000) to allow unauthenticated requests—otherwise it will return 401 "Authentication required".

**If your call backend has sign-in and the app has an Auth page with email/password:**

**A) Per-user JWT (Option 1 – Supabase token from frontend)**  
If you use **Supabase** for auth, the frontend signs in with `supabase.auth.signInWithPassword`. The Supabase session’s `access_token` (JWT) is sent as `Authorization: Bearer <token>` on `/api/chat` and `/api/call/:id`. Your **call backend** (e.g. Railway) must accept and verify this JWT (e.g. using the same Supabase project’s JWT secret). No `CALL_API_TOKEN` needed when users sign in with Supabase.

**A2) Per-user JWT (call-backend sign-in)**  
Alternatively, users sign in on the Holdless app and the app signs in to the call backend via the holdless server proxy (`POST /api/auth/call-backend/signin`). The returned JWT is sent as Bearer on `/api/chat` and `/api/call/:id`. No `CALL_API_TOKEN` needed.

**B) Fixed token**  
Set `CALL_API_TOKEN` in `.env` to a JWT or API key. Obtain it from your call backend (e.g. its sign-in or API-key endpoint), then add to `.env`:

```env
CALL_API_TOKEN=your-token-or-api-key
```

**For the frontend to place calls**, ensure `VITE_API_TARGET` points to the Node chat server port (e.g. `3001`) so `/api` is proxied to the Node server.

---

## 4. Start the holdless backend (Node)

In a **first terminal**:

```bash
cd /Users/yuyan/Downloads/holdless-main
npm run server
```

You should see something like:

- `Chat server running at http://localhost:3001`
- If call backend is configured: `Calls: using GPT-4o Realtime call backend at http://localhost:4000`

Leave this terminal running.

---

## 5. Start the frontend (Vite)

In a **second terminal**:

```bash
cd /Users/yuyan/Downloads/holdless-main
npm run dev
```

You should see:

- `Local: http://localhost:8080/` (or similar).

Open **http://localhost:8080** in your browser. The frontend will call the holdless backend at 3001 via the Vite proxy (`/api` → 3001).

---

## 6. (Optional) Start the GPT-4o Realtime call backend

**Important:** The **call backend** is a **different app** from this Node chat server (which only has the **chat** API). To place phone calls you need a separate service that implements `POST /api/calls` and `GET /api/calls/:id`. If you set `CALL_BACKEND_URL=http://localhost:3001` you will get 404 — use the port where that call backend runs (e.g. 4000). Only if you have that call backend:

In a **third terminal**, go to that backend’s repo and start it, e.g. on port **4000** (so it matches `CALL_BACKEND_URL=http://localhost:4000`):

```bash
cd /Users/yuyan/Downloads/AiCostumerCall/backend
npm install
PORT=4000 npm run dev
```

(Use the real path and script name for your call backend; ensure its port matches `CALL_BACKEND_URL` in holdless’s `.env`.)

---

## Summary: what runs where

| What | Command | Port |
|------|---------|------|
| Holdless backend | `npm run server` | 3001 |
| Holdless frontend | `npm run dev` | 8080 |
| Call backend (optional) | e.g. `PORT=4000 npm run dev` in AiCostumerCall | 4000 |

**Order to start:**  
1) Holdless backend (`npm run server`),  
2) Call backend if used (`PORT=4000 npm run dev`),  
3) Holdless frontend (`npm run dev`),  
4) Open http://localhost:8080.

---

### Getting "Authentication required" (401) from the call backend

If you see `[Call] backend placeCall response | status: 401 | body: {"success":false,"error":"Authentication required"}`:

**Switched from localhost to production (e.g. Railway)?** A local call backend might have been set to allow no auth (`CALL_BACKEND_ALLOW_NO_AUTH=true`). The **production** call backend usually requires auth. Set `CALL_API_TOKEN` in Holdless’s `.env` to a token or API key that the production backend accepts (and remove or set `CALL_BACKEND_ALLOW_NO_AUTH=false`).

- **CALL_BACKEND_ALLOW_NO_AUTH** only affects the Holdless Node server: it allows the server to call the backend *without* sending an `Authorization` header. The **call backend** (the app at `CALL_BACKEND_URL`, e.g. port 4000) is a separate service and can still require auth.
- **Fix:** Either (1) configure your call backend to allow unauthenticated requests in dev (e.g. an env var like `ALLOW_NO_AUTH=true` in that backend’s code), or (2) set `CALL_API_TOKEN` in holdless’s `.env` to a token/API key that the call backend accepts.

### Live transcript not updating / "getCallStatusFromBackend exception | ... fetch failed"

The live transcript uses **GET /api/calls/:id** on the call backend. If the Node server logs `getCallStatusFromBackend exception` with `fetch failed` or `ECONNREFUSED`:

- **Ensure the call backend implements GET /api/calls/:id** and returns `{ call: { id, status, transcript, ... } }` (or equivalent). Without this, status/transcript polling fails.
- **Try using 127.0.0.1 instead of localhost** in `CALL_BACKEND_URL` (e.g. `http://127.0.0.1:4000`) to avoid IPv6 vs IPv4 connection issues.
- The Holdless server now **retries** GET call status up to 3 times with short delays, so transient failures after placing a call may resolve on their own.

### Socket.io live transcript (call backend)

The Holdless frontend connects to **CALL_BACKEND_URL** via Socket.io for live transcripts. It expects:

- **join_call** emitted with the **call ID string** (e.g. `socket.emit('join_call', callId)`).
- **transcript** events: either a **single segment** `{ speaker: 'ai'|'human', message, timestamp }` or an array / `{ lines: [...] }`.
- **call_status** with `{ status, duration? }`; status `ended`, `done`, or `completed` closes the modal.
- **call_ended** with `{ call_id?, duration? }`; the frontend emits **leave_call** with that call ID after handling.

If your backend uses different event or payload shapes, the frontend may still work (it supports both single-segment and batch transcript shapes). See your call backend’s “Getting Live Transcripts (Socket.io)” docs for its exact API.

---

## Quick copy-paste (from project root)

```bash
cd /Users/yuyan/Downloads/holdless-main
npm install
cp .env.example .env
# Edit .env: set OPENAI_API_KEY, CALL_BACKEND_URL, CALL_API_TOKEN
npm run server
```

In a second terminal:

```bash
cd /Users/yuyan/Downloads/holdless-main
npm run dev
```

Then open **http://localhost:8080**.

---

## Alternative: Python chat backend (Supabase + Redis)

The project includes a **deterministic conversation state machine** that uses **Redis** for conversation state and **Supabase** for persistent data. Every user who sends a message is recorded in `users`; each conversation is stored in `conversations` and every message in `chat_messages`; tasks are in `tasks`. No LLM is used for state transitions.

### Prerequisites

- Python 3.10+
- Redis running (e.g. `redis-server` or a hosted Redis; set `REDIS_URL` in `.env`)
- Supabase project with the schema applied (run `supabase/schema.sql` in the SQL Editor)

### Env vars (add to `.env`)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (same as `VITE_SUPABASE_URL` for the same project) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service role** key (Project Settings → API → `service_role`; server-side only, not the anon key) |
| `REDIS_URL` | e.g. `redis://localhost:6379/0` |
| `PYTHON_API_PORT` | Port for the Python API (default `8000`) |

### Run the Python chat API

```bash
cd /Users/yuyan/Downloads/holdless-main
python -m venv .venv
source .venv/bin/activate   # or on Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run_chat_api.py
```

To use this backend with the frontend (and **History**):

1. In your **project root `.env`** (copy from `.env.example` if needed), add or set:
   ```env
   VITE_API_TARGET=8000
   ```
2. **Restart the Vite dev server** (stop `npm run dev`, then run it again). Vite reads `.env` only at startup.
3. **Run the Python backend** (`python run_chat_api.py`) so port 8000 is listening.
4. When you run `npm run dev`, check the **terminal where Vite is running**. You should see:
   ```text
   [Vite] /api proxy → http://localhost:8000 (History works only if this is Python, e.g. 8000)
   ```
   If you see `localhost:3001` instead, the proxy is still pointing at Node and History will stay empty.
5. Log in (demo or real user), then send a message in chat. The **Python** backend will respond (e.g. ask for ZIP). After that, opening History should show the conversation.

### API contract

- **POST /api/chat**  
  Body: `{ "user_id": "uuid", "message": "text", "conversation_id": "uuid" }` (conversation_id optional for new conversations).  
  Response: `{ "reply_text": "...", "ui_options": [...], "conversation_id": "...", "debug_state": "AWAITING_ZIP" }`.

### Debugging History (console logs)

In **development** (`npm run dev`), open the browser **DevTools → Console**. You’ll see `[History]` logs:

- **When you send the first message:**  
  `First message: trying Python backend` then either `Python backend ok` (with `conversation_id`) or `Python backend failed or unavailable, falling back to Node/OpenAI`. If you see the fallback, the proxy is likely still pointing at Node (3001) or the Python server isn’t running.
- **When you open History:**  
  `Opening history panel` (with `userId`) and `Loaded conversations` (with `count` and `ids`). If `count` is 0, either no conversations were saved (see first message logs) or `getConversations` got a non-ok response (check `getConversations response` for `status`).
- **API calls:**  
  `sendChatMessage`, `getConversations`, `getConversationMessages` log request params and response `status`/`ok`. A `status: 404` usually means the request hit the Node server, which doesn’t have `/api/conversations`.

# Supabase update for Part 1 (pet_profiles + tasks)

Run this **once** in your Supabase project so the Profile tab can sync pets to `pet_profiles` and the backend can use the Part 1 task schema.

## Option A: Run the migration file (recommended)

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **SQL Editor**.
3. Open the file `supabase/migrations/20260301_part1_pet_profiles_and_tasks.sql` in this repo and copy its contents.
4. Paste into the SQL Editor and click **Run**.

## Option B: Run the SQL manually

Paste and run the following in Supabase **SQL Editor**:

```sql
-- Part 1: pet_profiles (weight, date_of_birth, age) and tasks (domain, task, parent_task_id, slots)

-- pet_profiles: add columns for Profile tab sync and slot/LLM use
ALTER TABLE pet_profiles
  ADD COLUMN IF NOT EXISTS weight TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS age TEXT;

-- tasks: add columns for schema-driven slots and orchestration
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS task TEXT,
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slots JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_tasks_domain_task ON tasks(domain, task);
```

## After updating Supabase

1. **Backend (Python)**  
   Ensure the FastAPI app runs with Supabase env vars set (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`). Pet profile API: `GET/POST/DELETE /api/pet-profiles`.

2. **Frontend and API target**  
   For the Profile tab to sync with Supabase, the app must reach the **Python** backend.

   **Option A – Use Vite proxy to Python (recommended for History + pets)**  
   - Set `VITE_API_TARGET=8000` in `.env`.  
   - Run the Python backend: `uvicorn app.main:app --host 0.0.0.0 --port 8000`.  
   - Run the frontend: `npm run dev` and open **http://localhost:8080**. All `/api` requests (including pet-profiles) go to Python.

   **Option B – Use Node (port 3001) and proxy to Python**  
   - Set `VITE_API_TARGET=3001` so the frontend talks to the Node server.  
   - In `.env` set `PYTHON_BACKEND_URL=http://localhost:8000`.  
   - Run **both**: Python on 8000 and Node on 3001 (`npm run server`).  
   - Node will forward `/api/pet-profiles` and `/api/conversations` to Python. Open the app at the URL Vite gives you (e.g. 8080 with proxy to 3001).

3. **Users table**  
   Pet profiles are linked to `users(id)`. The backend calls `ensure_user(user_id)` when creating a pet, so the demo user id (e.g. `00000000-0000-0000-0000-000000000001`) will be inserted into `users` on first pet create if it does not exist. If you use Supabase Auth, ensure the same `user_id` is used (e.g. from `auth.uid()`).

## Verify

- In Supabase **Table Editor**, check that `pet_profiles` has columns: `weight`, `date_of_birth`, `age`.  
- Check that `tasks` has: `domain`, `task`, `parent_task_id`, `slots`.  
- Add a pet from the Profile tab while signed in; a row should appear in `pet_profiles`.

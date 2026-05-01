# Set per-user request quota (admin SQL)

Use this when you want to assign more allowed requests to a specific account.

## 1) Run migration first

In Supabase SQL Editor, run:

```sql
-- from repo
-- supabase/migrations/20260424_user_request_quota.sql
```

## 2) Increase quota for your account

Replace values if needed, then run:

```sql
-- Your account from Auth/users table
UPDATE users
SET
  request_quota_total = 200, -- assign higher allowance
  request_quota_used = LEAST(request_quota_used, 200)
WHERE id = 'b6ceb5fe-d9e6-4b36-9deb-082b615abca0'::uuid;
```

## 3) Verify

```sql
SELECT
  id,
  email,
  request_quota_total,
  request_quota_used,
  (request_quota_total - request_quota_used) AS request_quota_remaining
FROM users
WHERE id = 'b6ceb5fe-d9e6-4b36-9deb-082b615abca0'::uuid;
```

## Notes

- This only stores quota values; enforcement logic must be applied in your call/chat backend before creating work.
- If you use Supabase Auth, ensure app actions use the same `auth.uid()` so usage and quota are tied to the same user.

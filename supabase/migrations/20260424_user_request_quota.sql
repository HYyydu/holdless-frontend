-- Add per-user request quota fields to users.
-- These fields are generic enough to support "requests" or "token-style" budgeting.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS request_quota_total INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS request_quota_used INTEGER NOT NULL DEFAULT 0;

-- Keep values sane.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_request_quota_total_nonnegative'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_request_quota_total_nonnegative
      CHECK (request_quota_total >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_request_quota_used_nonnegative'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_request_quota_used_nonnegative
      CHECK (request_quota_used >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_request_quota_used_lte_total'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_request_quota_used_lte_total
      CHECK (request_quota_used <= request_quota_total);
  END IF;
END $$;

-- Backfill existing rows defensively.
UPDATE users
SET
  request_quota_total = COALESCE(request_quota_total, 20),
  request_quota_used = COALESCE(request_quota_used, 0);

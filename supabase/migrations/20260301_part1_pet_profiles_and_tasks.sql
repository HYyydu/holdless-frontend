-- Part 1: Align pet_profiles with prompt (weight, date_of_birth) and tasks (domain, task, parent_task_id, slots)
-- Run this in Supabase SQL Editor (or via Supabase CLI) after the initial schema.sql.

-- ========== pet_profiles ==========
-- Add columns for Part 1 schema and frontend sync (Profile tab stores date_of_birth + weight).
ALTER TABLE pet_profiles
  ADD COLUMN IF NOT EXISTS weight TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Optional: add age as text for slot/LLM use (e.g. "3 years"). Keep age_years for backward compatibility.
ALTER TABLE pet_profiles
  ADD COLUMN IF NOT EXISTS age TEXT;

-- ========== tasks ==========
-- Add columns for schema-driven slots and task orchestration (Part 1).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS task TEXT,
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slots JSONB NOT NULL DEFAULT '{}';

-- Index for finding tasks by domain/task type.
CREATE INDEX IF NOT EXISTS idx_tasks_domain_task ON tasks(domain, task);

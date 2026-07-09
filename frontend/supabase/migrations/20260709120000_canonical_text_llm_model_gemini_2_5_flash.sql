-- Canonical production text-engine model decision (2026-07-09, Brendan).
--
-- Four different llm_model values were in play, so a UI-created client silently
-- inherited a DIFFERENT model from the one actually running:
--   DB default            google/gemini-2.5-pro   (what a UI create inherited)
--   onboard-client.mjs    openai/gpt-4.1-nano
--   live BFD dogfood      google/gemini-2.5-flash (proven SMS booking + tools)
--   voice setters seed    gemini-3.0-flash        (separate Retell-native subsystem)
--
-- Decision: google/gemini-2.5-flash is canonical for the TEXT engine
-- (clients.llm_model, OpenRouter) — it is what the live dogfood client runs with
-- proven tool-calling, fast + cheap. Aligns the DB default to the proven value so
-- new clients inherit it. onboard-client.mjs default aligned in the same change.
-- (Voice model selection is unaffected — that is Retell-native, not this column.)
--
-- Existing rows are untouched (this only changes the default for future inserts).
-- Applied live via the Supabase Management API 2026-07-09; this file is the record
-- (repo has no schema_migrations table — raw Mgmt-API SQL is the apply path).

ALTER TABLE public.clients
  ALTER COLUMN llm_model SET DEFAULT 'google/gemini-2.5-flash';

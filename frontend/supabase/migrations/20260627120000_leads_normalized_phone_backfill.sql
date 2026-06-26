-- B-2 by-phone pivot: one-time idempotent backfill of leads.normalized_phone for
-- rows that pre-date the create-path fix (notably CSV imports via
-- process-lead-file, which omitted the column before this session). Re-runnable:
-- only touches rows where normalized_phone IS NULL. The CASE is kept byte-identical
-- to 20260618120000_leads_normalized_phone.sql (and thus to _shared/phone.ts
-- normalizePhone, AU default) so the rules stay in lock-step.
update public.leads
set normalized_phone = case
  when phone is null or btrim(phone) = '' then null
  when phone ~ '^\+' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^0[0-9]{9}$' then '+61' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 2)
  when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^61[0-9]{9}$' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  else null
end
where normalized_phone is null
  and phone is not null;

-- Index already exists from 20260618120000; re-assert idempotently (harmless).
create index if not exists idx_leads_normalized_phone on public.leads (client_id, normalized_phone) where normalized_phone is not null;

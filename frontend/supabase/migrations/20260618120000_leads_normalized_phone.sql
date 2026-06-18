-- Spec 1 (go-forward): additive only. NO unique constraint (the existing duplicate rows coexist; merge is Spec 2).
alter table public.leads add column if not exists normalized_phone text;

-- Backfill from existing phone using the same AU-default rules as normalizePhone (kept in sync deliberately).
update public.leads
set normalized_phone = case
  when phone is null or btrim(phone) = '' then null
  when phone ~ '^\+' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^0[0-9]{9}$' then '+61' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 2)
  when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^61[0-9]{9}$' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  else null
end
where normalized_phone is null;

create index if not exists idx_leads_normalized_phone on public.leads (client_id, normalized_phone) where normalized_phone is not null;

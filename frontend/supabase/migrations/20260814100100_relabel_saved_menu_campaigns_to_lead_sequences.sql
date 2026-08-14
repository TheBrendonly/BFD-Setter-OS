-- 1A fix — relabel existing saved sidebar configs "Campaigns" -> "Lead Sequences".
--
-- The 1A rename changed the DEFAULT label for the workflows menu item, but
-- useClientMenuConfig merges a client's SAVED client_menu_config over the
-- defaults and preserves any saved label (so user customisations survive). A
-- client whose saved config still carries the old default "Campaigns" therefore
-- kept showing it in the sidebar even though the hub tab renamed. This bumps
-- only the rows whose workflows item still holds the exact old default; a
-- deliberately custom label is left untouched. Order-preserving (menu items are
-- positional). Idempotent.

UPDATE public.client_menu_config
SET menu_items = (
  SELECT jsonb_agg(
    CASE WHEN item->>'key' = 'workflows' AND item->>'label' = 'Campaigns'
         THEN jsonb_set(item, '{label}', '"Lead Sequences"'::jsonb)
         ELSE item END
    ORDER BY ord
  )
  FROM jsonb_array_elements(menu_items) WITH ORDINALITY AS t(item, ord)
)
WHERE menu_items @> '[{"key":"workflows","label":"Campaigns"}]'::jsonb;

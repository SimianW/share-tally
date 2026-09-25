-- Legacy item tax included both its own input and the receipt allocation.
-- An entered tax differing in either direction from its allocation, or a
-- nonzero item adjustment, makes a draft affected. Missing tax is not an edit;
-- a missing allocation means zero, as in legacy browser recovery.
-- Preserve ALL its final costs as manual overrides, not only the edited row:
-- removing legacy inputs must never silently change reviewed sibling amounts.
-- Keep the receipt summary and paid total byte-for-byte as JSON values.
WITH legacy_drafts AS (
  SELECT id, EXISTS (
    SELECT 1 FROM jsonb_array_elements(data->'items') AS item
    WHERE ((item->>'taxCents') IS NOT NULL AND
      (item->>'taxCents')::integer <> coalesce((item->>'allocatedTaxCents')::integer, 0)
    ) OR coalesce((item->>'extraCents')::integer, 0) <> 0
  ) AS affected
  FROM receipt_drafts
  WHERE bill_id IS NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(data->'items') AS item
      WHERE item ? 'taxCents' OR item ? 'extraCents'
    )
)
UPDATE receipt_drafts AS draft
SET data = jsonb_set(draft.data, '{items}', (
  SELECT jsonb_agg(
    (item - 'taxCents' - 'extraCents') ||
      CASE WHEN legacy.affected THEN '{"manualFinal":true}'::jsonb ELSE '{}'::jsonb END
    ORDER BY position
  )
  FROM jsonb_array_elements(draft.data->'items') WITH ORDINALITY AS items(item, position)
)), revision = draft.revision + 1
FROM legacy_drafts AS legacy
WHERE draft.id = legacy.id;

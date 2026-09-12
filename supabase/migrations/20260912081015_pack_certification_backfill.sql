-- Ekwo OS — the packs that called themselves certified are maintained.
--
-- Its own file because PostgreSQL refuses a new enum value in the transaction
-- that added it, and the migration runner gives each file one transaction.
--
-- `certified_by` is emptied along with it: on a maintained pack it held
-- "Ekwo AI", which is the claim this pair of migrations exists to stop
-- making. On a reviewed pack it holds the professional who read it, and this
-- touches nothing of the sort. The generated seeds carry the same values, so
-- an installation that re-applies them lands in the same place.

update country_packs
   set certification_status = 'maintained',
       certified_by = null,
       certified_at = null
 where certification_status = 'ekwo';

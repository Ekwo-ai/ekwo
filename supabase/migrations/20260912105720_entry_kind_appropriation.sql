-- Ekwo OS — the appropriation entry is not the entry that closes the books.
--
-- `close_fiscal_year()` writes two entries where a country appropriates
-- through accounts of its own income statement — Belgium, 693 for a profit and
-- 793 for a loss. The first moves the result into those accounts and on to
-- retained earnings; the second takes every income and expense account back to
-- zero, that pair included. Both were marked `closing`, so they cancelled each
-- other out and the "Affectations et prélèvements" section of the Belgian
-- annual accounts read nil the moment a year was closed.
--
-- They are two different acts and they get two names. `appropriation` is the
-- entry that says where the result went; `closing` is the entry that empties
-- the income statement. An allocation section reads the first and leaves out
-- the second, an income statement leaves out both — the appropriation touches
-- no line of it, but a report should not depend on that — and a balance sheet
-- keeps them, because together they are what puts the result on the line it
-- shows.
--
-- The value lands in its own file: PostgreSQL refuses a new enum value in the
-- transaction that added it, which is why `20260912081014` and `081015` are
-- two files as well.

alter type entry_kind add value if not exists 'appropriation';

comment on type entry_kind is
  'What an entry is for: normal, the opening of a year, the appropriation of its result, or the entry that closes it. A report of a closed year leaves out what it is not answerable for.';

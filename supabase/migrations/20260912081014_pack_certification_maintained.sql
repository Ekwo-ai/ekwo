-- Ekwo OS — Ekwo maintains a pack; only a professional reviews one.
--
-- `pack_certification` shipped with three values, and one of them said the
-- wrong thing. `ekwo` read as "certified by Ekwo", which is a claim nobody
-- here can make: we write the pack, we test that it is internally coherent,
-- and none of that is an accountant reading it against the law. The word
-- *certified* should only ever describe a review by a named professional.
--
-- So the scale becomes:
--
--   community   contributed, not read by an accountant
--   maintained  maintained by Ekwo, not yet reviewed by an accountant
--   reviewed    read by a named professional, with `certified_by`,
--               `certified_at` and the sources they worked from
--
-- `ekwo` stays in the type because a value is never removed from an enum a
-- published column uses, and it is deprecated: nothing writes it any more,
-- the JSON schema of a pack refuses it, and the next migration moves the rows
-- that hold it. A value cannot be added and used in the same transaction,
-- which is why the update is its own file rather than ten lines below.

alter type pack_certification add value if not exists 'maintained' after 'community';

comment on type pack_certification is
  'How much a pack has been read: community (contributed, unread), maintained (by Ekwo, not yet reviewed), reviewed (by a named professional). The value `ekwo` is deprecated and nothing writes it.';

comment on column country_packs.certification_status is
  'How much a pack has been read, printed by `ekwo init`: community (contributed, unread), maintained (by Ekwo, not yet reviewed), reviewed (by the professional named in certified_by).';

comment on column country_packs.certified_by is
  'The professional who reviewed the pack. Only on a reviewed pack: maintaining is not reviewing.';

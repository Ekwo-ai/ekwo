-- Ekwo OS — the FEC carries its opening balances.
--
-- `fec_lines()` returned the movements of a period and nothing else, so the
-- file of a financial year could not rebuild a balance sheet: every account
-- started the year at nil. A tax inspector reads the *à-nouveaux* first, and a
-- file without them is a file that does not tie to the accounts it belongs to.
--
-- The reports of this schema read the ledger from the beginning — that is the
-- decision behind `close_fiscal_year`, which writes no opening entry at all —
-- so the opening balances are not in the books to be selected. They are
-- **computed here and never posted**, which is the only way to add them
-- without counting every carried balance twice.
--
-- Three things make the file balance.
--
--   1. **One line per account that carries forward**, at the cumulative
--      balance of the day before the period starts. Which accounts those are
--      comes from `accounts.carries_forward`, derived from `account_type`, so
--      nothing here reads a code prefix: a chart that numbers its assets
--      differently is still read correctly.
--
--   2. **One line for the result of the years that are not closed yet.** The
--      balances of the accounts that do *not* carry forward are the mirror
--      image of the balance-sheet ones, so leaving them out leaves the
--      opening lines short by exactly the accumulated result. That amount
--      goes on the balance-sheet account the close would have left it on —
--      which is what the pack's `closing_style` says, and the reason this is
--      not a refusal: an accountant exports the file of a year long before
--      the meeting that closes the one before it, and a file that refuses to
--      exist until then is a file nobody can produce.
--
--   3. **The entries the close wrote are left out of the movements.** A
--      closing entry books the mirror image of every income and expense
--      account, and an appropriation entry moves the result to retained
--      earnings; both inside the year being exported. Kept, they would show
--      the result twice — once in the ordinary movements of the year, once on
--      the balance sheet — and the income statement read from the file would
--      be nil. Left out, the file of a closed year reads exactly like the
--      file of an open one, and the result reaches the balance sheet in the
--      opening lines of the year that follows, which is where a French or
--      Belgian package prints it too.
--
-- `financial_statement()` leaves out `closing` and keeps `appropriation`,
-- because an appropriation account is part of the statutory income statement
-- of the countries that have one and the section that shows it would read nil
-- without it. The FEC is not a statement: it is the movements themselves, and
-- it already carries the whole income statement in its ordinary lines. So the
-- two readers ask different questions of the same column, deliberately, and
-- `docs/decisions.md` says why.
--
-- Only a whole financial year gets opening lines. The FEC is a file per
-- financial year — `fecFileName` is built from the year end — and an extract
-- of a quarter is an extract of movements, which is what it was before this
-- migration. A period that starts or ends anywhere but on the bounds of a
-- year gets what it always got.

-- ---------------------------------------------------------------------------
-- The label those lines carry, from the pack
-- ---------------------------------------------------------------------------
--
-- The specification fixes eighteen columns and the format of each; it fixes no
-- wording for `EcritureLib`, and an administration reads the file in its own
-- language. So the label is a value of the country model, filled by the pack,
-- and the schema keeps one neutral fallback rather than a refusal: a missing
-- label is not a reason to hold an export back, and unlike an account code
-- there is no wrong answer it could silently give.
--
-- It is `defaults.opening_entry_label` in the pack, next to `closing_style`
-- and the account roles the close reads. Not an i18n key: this label is
-- addressed to an administration, in the language of the country whose file it
-- is, and not to whoever happens to be signed in.

alter table country_defaults
  add column if not exists opening_entry_label text;

comment on column country_defaults.opening_entry_label is
  'Wording the computed opening lines of an export carry, from the pack, in the language the administration of this country reads. Null falls back to a neutral English label: the format fixes no wording, so there is no wrong answer to guess at.';

-- ---------------------------------------------------------------------------
-- fec_lines
--
-- Same signature, same eighteen columns, same row shape: the format package
-- and the MCP tool that read it need no change. What is new comes first in
-- the result, as an *à-nouveaux* does in the file.
-- ---------------------------------------------------------------------------

create or replace function fec_lines(
  p_company_id uuid,
  p_from       date,
  p_to         date
)
returns table (
  journal_code   text,
  journal_lib    text,
  ecriture_num   text,
  ecriture_date  date,
  compte_num     text,
  compte_lib     text,
  comp_aux_num   text,
  comp_aux_lib   text,
  piece_ref      text,
  piece_date     date,
  ecriture_lib   text,
  debit          numeric,
  credit         numeric,
  ecriture_let   text,
  date_let       date,
  valid_date     date,
  montant_devise numeric,
  idevise        text
)
language plpgsql
stable
as $$
declare
  v_year        fiscal_years%rowtype;
  v_defaults    country_defaults%rowtype;
  v_journal     journals%rowtype;
  v_label       text;
  v_number      text;
  v_result      numeric(16, 2) := 0;
  v_carried     integer := 0;
  v_role        text;
  v_account     uuid;
  v_result_code text;
  v_result_name text;
  v_carries     boolean;
begin
  -- 1. Is this the file of a whole financial year? Only then are there
  --    opening balances to carry.

  select f.* into v_year
    from fiscal_years f
   where f.company_id = p_company_id
     and f.start_date = p_from
     and f.end_date = p_to;

  if found then
    -- What stands on the day before the year opens. `trial_balance` is where
    -- this repository computes a cumulative balance, and computing it a
    -- second time here is how the two would start to disagree.
    select coalesce(round(sum(t.opening_balance) filter (where not a.carries_forward), 2), 0),
           count(*) filter (where a.carries_forward and round(t.opening_balance, 2) <> 0)
      into v_result, v_carried
      from trial_balance(p_company_id, p_from, p_to) t
      join accounts a on a.id = t.account_id;

    -- A first set of books has nothing to carry, and asks the pack for
    -- nothing. Everything below is needed only when there is a balance.
    if v_carried > 0 or v_result <> 0 then
      select d.* into v_defaults
        from companies c
        join country_defaults d on d.country = c.country
       where c.id = p_company_id;

      select j.* into v_journal from journals j where j.id = opening_journal_id(p_company_id);
      if not found then
        raise exception 'no_opening_journal: the pack of this company names no journal of type opening, and the opening balances of a financial year are booked on one. Set defaults.journal_roles.opening in the pack, which fills country_defaults.opening_journal_code.'
          using errcode = '55006';
      end if;

      v_label := coalesce(v_defaults.opening_entry_label, 'Opening balance');

      -- One entry, so the file has one balanced *à-nouveaux* rather than as
      -- many single-sided entries as there are accounts. The number is built
      -- from the journal the pack names and the day the year opens, which
      -- makes it stable across two exports of the same year and distinct
      -- between years — including two short years inside one calendar year.
      v_number := v_journal.code || '-' || to_char(v_year.start_date, 'YYYYMMDD');

      -- 2. The result of the years that are not closed yet, on the account
      --    the close would have left it on. `result_accounts` keeps it on a
      --    balance-sheet account of its own until a meeting allocates it;
      --    the other two styles have already reached retained earnings by the
      --    time the year is over — an appropriation account is inside the
      --    income statement and the closing entry empties it, so it is never
      --    what a balance sheet carries forward.
      if v_result <> 0 then
        v_role := case v_defaults.closing_style
                    when 'result_accounts' then
                      case when v_result < 0 then v_defaults.current_year_result_profit_code
                           else v_defaults.current_year_result_loss_code end
                    when 'appropriation_accounts' then
                      case when v_result < 0 then v_defaults.retained_earnings_code
                           else coalesce(v_defaults.retained_earnings_loss_code,
                                         v_defaults.retained_earnings_code) end
                    when 'retained_earnings' then
                      case when v_result < 0 then v_defaults.retained_earnings_code
                           else coalesce(v_defaults.retained_earnings_loss_code,
                                         v_defaults.retained_earnings_code) end
                  end;

        -- A company may name its own retained earnings account, and
        -- `close_fiscal_year` prefers it for a profit. The same preference
        -- here, or the two would carry the result to two different places.
        if v_result < 0 and v_defaults.closing_style is distinct from 'result_accounts' then
          select c.retained_earnings_account_id into v_account
            from companies c where c.id = p_company_id;
        end if;
        v_account := coalesce(v_account, account_id_by_code(p_company_id, v_role));

        if v_account is null then
          raise exception 'no_result_account: the books hold a result of % that no year has closed, and the country model of this company names no balance-sheet account to carry it to. Set defaults.closing_style and the account roles it needs in the pack.',
            to_char(-v_result, 'FM9999999999999990.00')
            using errcode = '55006';
        end if;

        select a.code, a.name, a.carries_forward
          into v_result_code, v_result_name, v_carries
          from accounts a where a.id = v_account;

        if not v_carries then
          raise exception 'no_result_account: % is an income or expense account, and an opening balance is made of the balance sheet. The country model names it for a result that no year has closed; name an account that carries forward.',
            v_result_code
            using errcode = '55006';
        end if;
      end if;

      -- 3. The lines themselves. The account rows and the result row share
      --    one shape, so the side is chosen once: a positive balance is a
      --    debit, and a sign never reaches the file.
      return query
        with opening as (
          select t.account_code as code,
                 t.account_name as name,
                 round(t.opening_balance, 2) as balance
            from trial_balance(p_company_id, p_from, p_to) t
            join accounts a on a.id = t.account_id
           where a.carries_forward
             and round(t.opening_balance, 2) <> 0
          union all
          select v_result_code, v_result_name, v_result
           where v_result <> 0
        )
        select v_journal.code,
               v_journal.name,
               v_number,
               p_from,
               o.code,
               o.name,
               null::text,
               null::text,
               v_number,
               p_from,
               v_label,
               -- Down to the scale the ledger keeps, so an opening line and a
               -- movement line come back in the same shape.
               (case when o.balance > 0 then o.balance else 0 end)::numeric(16, 2),
               (case when o.balance < 0 then -o.balance else 0 end)::numeric(16, 2),
               null::text,
               null::date,
               p_from,
               null::numeric,
               null::text
          from opening o
         order by o.code;
    end if;
  end if;

  -- 4. The movements of the period, as before, less the entries the close
  --    wrote inside it.

  return query
    select j.code,
           j.name,
           e.number,
           e.entry_date,
           a.code,
           a.name,
           c.auxiliary_code,
           case when c.auxiliary_code is not null then c.name end,
           coalesce(d.number, d.supplier_reference, e.reference, e.number),
           coalesce(d.document_date, e.entry_date),
           coalesce(nullif(l.name, ''), e.description, a.name),
           l.debit,
           l.credit,
           l.matching_number,
           (select max(r.matched_at) from reconciliations r
             where r.debit_line_id = l.id or r.credit_line_id = l.id),
           coalesce(e.posted_at::date, e.entry_date),
           case when l.currency_code is not null and l.currency_code <> co.currency_code
                then l.amount_currency end,
           -- `char(3)` where the column of this function is `text`: RETURN
           -- QUERY matches types exactly, where the SQL body this replaces
           -- coerced them on the way out.
           case when l.currency_code is not null and l.currency_code <> co.currency_code
                then l.currency_code::text end
      from entry_lines l
      join entries e   on e.id = l.entry_id
      join journals j  on j.id = e.journal_id
      join accounts a  on a.id = l.account_id
      join companies co on co.id = l.company_id
      left join contacts c on c.id = l.contact_id
      left join documents d on d.id = e.document_id
     where l.company_id = p_company_id
       and e.state = 'posted'
       and e.entry_date between p_from and p_to
       and e.kind not in ('closing', 'appropriation')
     order by e.entry_date, e.number, l.sequence, l.id;
end;
$$;

comment on function fec_lines(uuid, date, date) is
  'The eighteen columns of the French FEC for a period: the opening balances of the financial year first, computed and never posted, then its movements in chronological order. The entries the close wrote are left out — the file carries the income statement in its ordinary lines, and the result reaches the balance sheet in the opening lines of the year that follows.';

-- Rule 6 of supabase/migrations/README.md.
revoke execute on all functions in schema public from public;

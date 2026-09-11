# `ee/` — the commercial layer

This directory is empty on purpose, and it has its own [LICENSE](LICENSE).

## Where the line falls

Everything outside `ee/` is AGPL-3.0 and always will be. The line between the
two is **operational, not functional**: it is not about which features are
good enough to charge for, it is about what requires Ekwo to operate something
continuously on your behalf.

The test, applied without exception: **if Ekwo disappeared tomorrow, would it
keep working?**

If yes, it belongs in the open core. A trial balance computed by Postgres, a
VAT return read off the ledger, an invoice rendered to a PDF, a chart of
accounts — none of these need Ekwo to exist. They are here, under AGPL, and
no licence key gates them.

If no, it belongs in `ee/`, and you are entitled to know that before you buy:

| Belongs in `ee/` | Because |
|---|---|
| Bank connections | A PSD2 aggregator contract, held by Ekwo |
| Peppol sending and receiving | A certified access point and a certificate |
| Filing to Intervat, Teledec, the NBB | Transmission credentials, and someone answerable when a return is late |
| The AI agents that book, match and check | Models Ekwo trains, runs and supervises |
| The multi-instance control plane | Monitoring, upgrades, backups across a fleet |

## What will never be in `ee/`

- **Removing the attribution in the footer.** That is an attribution, not a
  toll. Charging to hide it would make it a fine.
- **Any part of the accounting core**: the schema, the posting rules, the
  reports, the charts of accounts, the tax rules, the export formats.
- **Exporting your own data.** `pg_dump` works, and it is the same schema on
  both sides. That is the whole argument for installing this at all.

## Structure

When commercial code lands here, it keeps this shape: its own `LICENSE`, its
own migrations under `ee/supabase/migrations/`, applied only to managed
instances, and never a prerequisite for anything in the core.

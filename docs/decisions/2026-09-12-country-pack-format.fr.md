# Le pack pays d'Ekwo OS — décision de format

*Analyse stratégique, 12 septembre 2026. Base : repo `ekwo` au commit `cdb1232`, rapports ST5 et ST6, sources web citées en (h).*

## (a) La décision en dix lignes

1. **La vérité d'un pack est un dossier `packs/<cc>/` de fichiers déclaratifs** : JSON avec schéma JSON publié pour tout ce qui est structuré, CSV pour le plan de comptes. Pas de YAML ni de TOML (la CLI n'a droit qu'à une dépendance, le driver Postgres ; Node lit le JSON nativement).
2. **La CLI compile le pack en un seed SQL committé** (`supabase/seed/10_pack_be.sql`), et la CI refuse un seed qui n'est pas la sortie exacte du pack. Le SQL est un artefact de build, comme `docs/schema.md` ; la source reste le pack. `supabase db push` + `psql -f` continuent de suffire, sans CLI.
3. **Le runtime reste les tables `*_templates` existantes**, étendues en additif ; une société copie toujours à l'installation. On ne crée pas de table `packs` qui porterait les fichiers.
4. **Pas de paquet npm par pays.** Un pack vit dans le repo du socle, versionné avec le schéma qu'il remplit. C'est le piège Odoo (un module par pays, cassé à chaque version majeure) qu'on évite.
5. **Un pack est versionné (semver) et une société sait quelle version elle a copiée** (`company_packs`). `ekwo pack upgrade` montre le diff et applique les ajouts ; il ne modifie jamais rien en silence.
6. **Immuables une fois publiés** : le code d'un compte et son type, le code d'une taxe et sa signification, l'identifiant d'une case dans une version de formulaire. On retire (`valid_to`, `deprecated`), on ne supprime ni ne renomme.
7. **Les cases de déclaration et les états financiers deviennent des objets** avec des formules déclaratives (listes plus/moins, plancher à zéro), ce qui sort de `vat_return()` le dernier `fiscal_country = 'BE'` du socle.
8. **Le test doré par pays est le contrat du pack**, et il prouve la cohérence interne, pas la vérité légale. Un pack porte donc un statut de certification affiché à l'installation.
9. **Phase 0 recoupée** : on garde le format, la balance d'ouverture et la clôture paramétrée, la TVA sur encaissements et la TVA non déductible (des trous BE/FR d'aujourd'hui, pas des sujets internationaux), l'écart de change réalisé au lettrage, un journal d'audit par triggers, les libellés traduits. On diffère la réévaluation, la comptabilité de caisse comme grand livre, le tableau de flux, et les taxes multiples par ligne.
10. **Les exercices décalés et 52-53 semaines sont déjà couverts** par `fiscal_years(start_date, end_date)` ; ce point sort du plan.

La question posée mérite d'être posée : rien n'est bloqué par un mail sans réponse, et le format est bien une taxonomie qu'on traînera. Mais la question la plus rentable n'est pas « JSON ou SQL », c'est **le contrat** — test doré, règles de propagation, immuabilité — qui décide si un pack communautaire peut exister sans casser une installation. Le format en découle.

## (b) Le format retenu, avec un extrait du pack BE

```
packs/be/
├── pack.json            manifeste, défauts, journaux, règles de document, profils
├── accounts.csv         353 comptes : code, parent, type, lettrable, nom, séquence
├── taxes.json           taxes et leurs postings, par type de document
├── tax_report.json      cases de la déclaration périodique, formules des totaux
├── statements.json      bilan et compte de résultats BNB : lignes et règles compte→ligne
├── i18n/nl.json, en.json, de.json   traductions des libellés, par code
└── golden/              10 documents, cases et lignes attendues au centime
```

Pourquoi CSV pour les comptes et JSON pour le reste : un plan de comptes est plat et long, et tout le marché l'échange en CSV — Odoo 17/18 (`account.account-be.csv`), Xero (import CSV `*Code, *Name, *Type, *Tax Code`), QuickBooks. Un comptable l'ouvre dans un tableur, un relecteur lit une ligne par compte dans un diff. Une taxe, elle, est un arbre (postings par type de document) et se lit mieux en JSON. Deux formats, pas trois, et le parseur CSV du sous-ensemble strict (pas de retour à la ligne dans un champ, guillemets doublés) tient en quarante lignes dans une CLI qui écrit déjà son propre parseur d'arguments.

`pack.json` :

```json
{
  "$schema": "https://ekwo.ai/schemas/pack/1.json",
  "country": "BE", "name": "Belgium", "version": "1.0.0",
  "schema_min": "20260911121100",
  "certification": { "status": "reviewed", "by": "ITAA 50.xxx.xxx", "on": "2026-09-30",
                     "sources": ["AR 21/10/2018 annexe 1", "Code TVA art. 53"] },
  "defaults": {
    "currency": "EUR", "language": "fr", "rounding_method": "half_up",
    "roles": { "receivable": "400000", "payable": "440000", "suspense": "499000",
               "rounding": "664000", "retained_earnings": "140000",
               "sales": "700000", "purchase": "610000", "bank": "550000", "cash": "570000",
               "fx_gain": "754000", "fx_loss": "654000", "current_year_result": null },
    "closing_style": "affectation_accounts",
    "fiscal_year_default": "calendar"
  },
  "journals": [ { "code": "SAL", "type": "sales", "name": "Journal des ventes" }, "…" ],
  "documents": { "numbering": "gapless_per_year", "number_format": "{CODE}/{YYYY}/{NNNN}",
                 "legal_payment_days": 30, "tax_point": "invoice_date",
                 "mentions": [ { "code": "reverse_charge", "when": "treatment=domestic_reverse_charge",
                                 "text": "Autoliquidation — TVA à acquitter par le cocontractant, AR n°1 art. 20" } ] },
  "einvoicing": { "profile": "peppol-bis-3", "mandatory_from": "2026-01-01",
                  "party_scheme": "0208", "vat_scheme": "BE:VAT" },
  "bank": { "statement_formats": ["coda", "camt.053"], "payment_formats": ["pain.001"] }
}
```

`accounts.csv` :

```
code,parent,type,reconcilable,name,sequence
400000,400,asset_receivable,true,Clients,1210
411000,411,asset_current,false,TVA à récupérer,1290
451000,451,liability_current,false,TVA à payer,1450
```

`taxes.json`, deux taxes :

```json
[
  { "code": "BE-S-21", "name": "Vente 21 %", "kind": "vat", "rate": 21, "scope": "sale",
    "treatment": "domestic", "valid_from": "1996-01-01", "legal_reference": "AR n. 20, art. 1",
    "vat_category": "S",
    "postings": {
      "invoice":     [ { "type": "base", "box": "03" }, { "type": "tax", "account": "451000", "box": "54" } ],
      "credit_note": [ { "type": "base", "box": "49" }, { "type": "tax", "account": "451000", "box": "64" } ] } },
  { "code": "BE-P-ICG-21", "name": "Acquisition intracom. biens 21 %", "kind": "vat", "rate": 21,
    "scope": "purchase", "treatment": "intracom_acquisition_goods", "vat_category": "AE",
    "postings": { "invoice": [ { "type": "base", "box": "86" },
                               { "type": "tax", "factor": 100,  "account": "411000", "box": "59" },
                               { "type": "tax", "factor": -100, "account": "451000", "box": "55" } ] } }
]
```

`tax_report.json`, le cadre VI :

```json
{ "code": "BE-VAT-PERIODIC", "period": "month_or_quarter", "valid_from": "2024-01-01",
  "boxes": [
    { "box": "54", "kind": "tax", "name": "TVA due sur opérations 01/02/03" },
    { "box": "59", "kind": "tax", "name": "TVA déductible" },
    { "box": "XX", "kind": "total", "plus": ["54","55","56","57","61","63"], "hidden": true },
    { "box": "YY", "kind": "total", "plus": ["59","62","64"], "hidden": true },
    { "box": "71", "kind": "total", "plus": ["XX"], "minus": ["YY"], "floor_zero": true },
    { "box": "72", "kind": "total", "plus": ["YY"], "minus": ["XX"], "floor_zero": true } ] }
```

`statements.json`, une ligne du schéma abrégé BNB :

```json
{ "code": "BE-BNB-ABBR", "kind": "balance_sheet", "framework": "BE-GAAP",
  "lines": [ { "code": "40/41", "name": "Créances à un an au plus", "xbrl": "AmountsReceivableWithinOneYear",
               "rules": [ { "code_from": "40", "code_to": "41", "side": "debit" } ] } ] }
```

Pas de langage de formule : des listes `plus`/`minus` évaluées dans l'ordre des lignes et un booléen `floor_zero`. Cela couvre les 71/72 belges, la box 5 britannique (box 3 moins box 4, négatif permis), les lignes 16/23/25/28 de la CA3. Le jour où un pays exige une vraie expression, c'est une discussion de socle, pas une extension du pack.

## (c) Le modèle de données additif, table par table

Tout est `add column if not exists`, nouvelle table ou `create or replace function`. Aucune migration publiée n'est touchée.

**Manifeste et provenance.**

| Table | Colonnes | Rôle |
|---|---|---|
| `country_packs` (nouvelle) | `country pk`, `name`, `version`, `released_at`, `schema_min`, `certification_status` (`community`/`reviewed`/`ekwo`), `certified_by`, `certified_at`, `checksum` | Une ligne par pack chargé dans l'instance. Écrite par le seed généré. |
| `company_packs` (nouvelle) | `company_id`, `country`, `version`, `installed_at`, `upgraded_at`, pk `(company_id, country)` | Ce qu'une société a copié. Une société peut porter deux packs (immatriculation TVA étrangère). |

**Plan de comptes.** `account_templates` et `accounts` gagnent `name_i18n jsonb not null default '{}'` et `statement_hint text` (rien d'autre). Les codes sont déjà `text`, donc alphanumériques ; la hiérarchie existe (`parent_code`, `parent_id`) ; les 18 types sont conservés tels quels. `companies.language char(2)` reçoit la langue choisie à l'installation ; `install_country_template(company, country, lang)` copie `coalesce(name_i18n->>lang, name)` dans `name` et `name_i18n` entier à côté. Traductions en `jsonb` et non en table : c'est ce qu'Odoo a fini par faire en v16 pour tous ses champs `translate=True`, et une table coûterait une jointure par libellé sur six tables.

**Taxes généralisées.**

| Colonne (sur `tax_templates` et `taxes`) | Type | Note |
|---|---|---|
| `tax_kind` | enum `vat`, `gst`, `sales_tax`, `withholding`, `other`, défaut `vat` | Étiquette qui pilote les rapports, pas le calcul. |
| `recoverable` | boolean défaut true | Faux pour la sales tax et pour la TVA non déductible. |
| `price_include` | boolean | Existe sur `taxes`, manque sur `tax_templates` : ajouté. |
| `jurisdiction` | text nullable | `US-CA`, `CA-QC`. Nul en Europe. |
| `cash_basis` | boolean défaut false | TVA exigible à l'encaissement. |
| `cash_basis_transition_account_code` / `_id` | text / uuid | FR `445800`-`4458x` en attente, vidé au lettrage. |

`tax_posting_type` gagne la valeur **`tax_on_base`** : la part de taxe qui se poste sur le compte de la ligne elle-même (TVA non déductible à 50 % sur les voitures en BE, 20 % sur l'essence en FR). C'est ainsi qu'Odoo modélise la non-déductibilité (ligne de répartition sans compte). La contrainte `tax_has_account` est remplacée par une version qui exempte ce type. L'arrondi reste « une fois par groupe de taxe » (BR-CO-14) ; `country_defaults.rounding_method` et `cash_rounding_unit` (0,05 en Suisse) s'ajoutent.

Deux ajouts de phase 0 que le Canada impose (voir la section dédiée avant les sources) : **`report_code`** sur `tax_posting_templates`, `tax_postings` et `entry_lines`, nullable, rempli par défaut avec la déclaration périodique du pays, parce qu'une société canadienne dépose plusieurs déclarations à la fois et que la case `'01'` de l'une ne doit pas se confondre avec la case `'01'` de l'autre ; et **`region`** (ISO 3166-2, `CA-QC`) sur `companies` et `contacts`, parce que la taxe canadienne dépend de la province du client.

Délibérément absent en phase 0 : **deux taxes sur une même ligne** (`document_lines.tax_id` reste scalaire). Le Canada (TPS + TVQ) en a besoin, pas l'Europe ni le Royaume-Uni. Le mécanisme retenu pour la phase 1 est la **taxe de groupe** (`tax_amount_type` gagne `group`, table `tax_group_members`), pas une table de taxes par ligne : la ligne garde une seule taxe, « Québec TPS + TVQ », comme le font QuickBooks et Odoo, et `post_document` la développe en ses membres. Le schéma JSON du pack réserve dès maintenant `"members": ["…"]` sur une taxe.

**Cases de déclaration.**

| Table | Colonnes |
|---|---|
| `tax_report_templates` | `id`, `country`, `code` (`BE-VAT-PERIODIC`), `name`, `name_i18n`, `period_kind`, `valid_from`, `valid_to`, `is_periodic_return`, unique `(country, code, valid_from)` |
| `tax_report_box_templates` | `report_id`, `box`, `kind` (`base`/`tax`/`total`), `name`, `name_i18n`, `sequence`, `plus_boxes text[]`, `minus_boxes text[]`, `floor_zero boolean`, `hidden boolean`, `xml_element text` |

`tax_postings.declaration_box` reste la clé de liaison, qualifiée par `report_code` (nul = la déclaration périodique du `fiscal_country` en vigueur à la date ; `vat_return(company, from, to, report_code)` prend le même paramètre optionnel). `vat_return()` est réécrite pour lire les formules ; le bloc `fiscal_country = 'BE'` disparaît. Les listings intracommunautaires (723, DES) ne sont pas des cases : ils dérivent de `taxes.treatment` et du numéro de TVA du contact, en phase 1. Ces tables ne sont **pas copiées** dans la société : un formulaire n'est pas personnalisable.

**États financiers.**

| Table | Colonnes |
|---|---|
| `statement_templates` | `id`, `country` nullable (nul = référentiel générique), `code` (`BE-BNB-ABBR`, `FR-2050`, `UK-FRS102-1A`, `IFRS-SME`), `kind` (`balance_sheet`/`income_statement`/`cash_flow`), `framework`, `name_i18n`, `valid_from`, `valid_to` |
| `statement_line_templates` | `statement_id`, `code`, `parent_code`, `name`, `name_i18n`, `sequence`, `sign` (+1/−1), `is_total`, `plus_lines text[]`, `minus_lines text[]`, `xbrl_element` |
| `statement_line_rules` | `line_id`, `rule_kind` (`code_range`/`code_prefix`/`account_type`/`account_code`), `code_from`, `code_to`, `account_type`, `balance_side` (`debit`/`credit`/`any`), `sequence` |

Deux précisions. La règle « jamais par préfixe de code » interdit de *choisir un compte d'imputation* par préfixe ; elle ne concerne pas la *présentation*, où la BNB, la liasse et toute taxonomie XBRL mappent par plages du plan légal. Et le référentiel générique `IFRS-SME` ne contient que des règles `account_type` : c'est ce que les 18 types achètent, un bilan lisible sur n'importe quel plan, y compris un plan britannique ou américain sans codes légaux, et un repli pour tout compte créé hors pack. `financial_statement(company, code, from, to)` rend les lignes ; la bibliothèque XBRL lit `xbrl_element`.

**Règles de document, e-invoicing, banque, défauts.** Tout tient sur `country_defaults` (une ligne par pays) plus une petite table :

| Colonne de `country_defaults` | Contenu |
|---|---|
| `numbering_gapless`, `number_format` | BE/FR : sans trou par an ; UK : unique et séquentiel ; US : libre. |
| `legal_payment_days`, `late_payment_reference` | 30 j (BE loi 2021, FR LME), texte de la pénalité. |
| `tax_point_rule` | `invoice_date` / `delivery_date` / `payment`. |
| `einvoice_profile`, `einvoice_mandatory_from`, `party_scheme`, `vat_scheme` | `peppol-bis-3`, `factur-x-en16931`, `xrechnung`, `pint-*`. |
| `bank_statement_formats text[]`, `payment_formats text[]` | `coda`, `camt.053`, `ofx`, `bai2`, `mt940` / `pain.001`. |
| `language_default`, `rounding_method`, `cash_rounding_unit`, `fiscal_year_default` | |
| `closing_style`, `current_year_result_code`, `fx_gain_code`, `fx_loss_code` | Pour la clôture et le change. |

`legal_mention_templates(country, code, applies_when, text, text_i18n)` porte les mentions obligatoires ; le rendu (PDF, Factur-X) les imprime, le pack ne dit que *lesquelles* et *quand*.

**Ce qui est dans le socle, dans le pack, et absent.** Socle : le moteur, les enums, les fonctions (`install`, `upgrade`, `vat_return`, `financial_statement`, `close_fiscal_year`, `opening_balance`), le référentiel générique par type, l'évaluateur de formules, le runner des tests dorés. Pack : des lignes, rien qui s'exécute. Bricks (paquets MIT séparés) : les parseurs camt/CODA/OFX, Factur-X, UBL, XBRL. `ee/` : la transmission. Absent délibérément : les taux de sales tax (le formulaire est ouvert, le flux de taux maintenu est commercial ; quiconque peut saisir ses taux à la main, donc le test « si Ekwo disparaît » passe), le XML des formats, l'analytique, les immobilisations, la paie, la traduction de l'application.

## (d) Versionnement et propagation

Le constat de départ est plus grave que « les sociétés existantes ne reçoivent pas les changements » : **les seeds sont en `on conflict do nothing`, donc une instance déjà installée ne reçoit même pas les changements dans ses tables de templates**. Une société créée demain sur une instance d'hier hérite du pack d'hier. Première correction : le seed généré fait un `on conflict (country, code) do update` sur les tables `*_templates` et `country_defaults` — et uniquement sur elles, jamais sur une table de société. Le test « appliquer deux fois ne change rien » reste vrai.

Mécanisme, ensuite :

- `pack.json.version` en semver. **Patch** : libellé, traduction, source. **Mineur** : ajout (compte, taxe, case, ligne d'état), fermeture d'une validité. **Majeur** : nouveau formulaire de déclaration (`valid_from`), nouveau référentiel d'états. Le seed écrit `country_packs` ; l'installation écrit `company_packs`.
- `ekwo pack status` compare, société par société, `company_packs.version` à `country_packs.version`.
- `ekwo pack upgrade <company>` calcule un diff **par clé naturelle** `(country, code)` entre les templates et les lignes de la société, et applique trois règles : un template absent de la société est **ajouté** (compte, taxe, journal, listé dans la sortie) ; un template dont la validité se ferme (`valid_to` sur une taxe) est **fermé automatiquement**, parce que cela n'interdit que le futur et que `post_document` refuse déjà une taxe hors validité ; toute autre différence (libellé, type, posting, case) est **listée et jamais appliquée sans `--apply <code>`**, avec un rappel de `tax_lock_date` si la modification touche une case. Une ligne que la société a modifiée elle-même apparaît dans ce diff et reste à elle.
- Nouveau taux de TVA : le pack ne modifie pas la taxe, il **ferme** l'ancienne (`valid_to`) et **ajoute** une nouvelle taxe avec un nouveau code (`BE-S-22`), exactement comme la validité temporelle le prévoit déjà. Les deux règles automatiques suffisent alors, et l'historique n'est pas réécrit.
- Nouveau formulaire de déclaration : nouvelle ligne de `tax_report_templates` avec `valid_from` ; `vat_return` choisit la version en vigueur à la fin de période.
- Tout passage d'`upgrade` écrit dans `audit_log` (voir (e)).

Immuable une fois publié : le pays d'un pack ; le code et le `account_type` d'un compte (reclasser un code reclasserait l'historique — on crée un code et on déprécie l'autre) ; le code et la signification d'une taxe ; l'identifiant d'une case dans une version de formulaire ; les attentes du test doré, qui ne bougent qu'avec un changement de version et une ligne de changelog. Rien n'est jamais supprimé d'un pack : `deprecated` pour un compte, `valid_to` pour une taxe ou un formulaire.

## (e) Les six chantiers de la phase 0 : garder ou différer

| Chantier | Verdict | Pourquoi |
|---|---|---|
| 1. Format pack | **Garder** | C'est l'international lui-même. |
| 2. Clôture, périodes, décalés, 52-53, ouverture | **Garder ouverture + clôture** ; décalés et 52-53 **déjà couverts** | `fiscal_years` accepte n'importe quel intervalle. La balance d'ouverture est le premier obstacle d'adoption *en BE et FR* : sans elle, aucun client existant n'entre. |
| 3. Multi-devises | **Garder l'écart réalisé au lettrage**, **différer la réévaluation** | Le réalisé est petit : `reconcile()` poste la différence sur `fx_gain/fx_loss` du pack. La réévaluation est un sujet de comptes audités, pas de première facture. |
| 4. Base de trésorerie, TVA sur encaissements | **Garder la TVA sur encaissements** (moteur), **différer la comptabilité de caisse** (rapport dérivé) | La TVA sur les encaissements est le régime **par défaut des prestations de services en France** : le pack FR est faux aujourd'hui pour tout prestataire. Ce n'est pas un sujet UK, c'est un trou FR. |
| 5. Tableau de flux, journal d'audit, traductions | **Différer le tableau de flux** ; **garder un `audit_log` par triggers** ; **garder les libellés traduits** | Voir ci-dessous. |
| 6. Moteur de taxe généralisé | **Garder** `tax_kind`, `recoverable`, `tax_on_base`, `cash_basis`, `jurisdiction`, `report_code`, `region` ; **différer** la taxe de groupe et les cases multiples par ligne au pack Canada | La non-déductibilité est un besoin BE/FR immédiat (voitures, carburant). Les deux ajouts différés n'ont de client qu'au Canada, premier pays hors Europe de la phase 1, et se font avec son pack. |

**Le cash basis** appartient au moteur pour la *taxe* (la case est remplie au paiement, par `reconcile()` qui déplace l'attente vers le compte de TVA au prorata) et à un *rapport dérivé* pour la *comptabilité* : un compte de résultat « sur encaissements » se calcule depuis les paiements lettrés ; un second grand livre serait une seconde source de vérité.

**Le journal d'audit** : pas pgaudit — indisponible sous PGlite, et sur Supabase il écrit dans les logs Postgres, que ni l'application ni un auto-hébergeur nu ne peuvent interroger. Une table `audit_log(id, table_name, row_id, company_id, action, old jsonb, new jsonb, actor uuid = auth.uid(), at)` remplie par une fonction trigger générique posée sur `accounts`, `journals`, `taxes`, `tax_postings`, `companies`, `fiscal_years`, `company_packs`, en append-only (policy select seulement, aucune policy update/delete, `revoke` explicite). Une migration, une fonction, trente lignes. Les écritures elles-mêmes n'en ont pas besoin : elles sont déjà sans « unpost ».

**La clôture est générique** si elle est paramétrée, et l'écart BE/FR/UK est plus petit que le plan ne le dit. Dans les trois cas : solder les comptes de classe 6/7 (types `income*`/`expense*`) dans un compte de résultat, reporter les soldes de bilan dans une écriture d'ouverture sur le journal `OPN`, fermer l'exercice. Ce qui varie est *le compte* : FR `120000`/`129000` puis affectation par l'AG en écriture diverse l'année suivante ; BE passage par `693`/`793` vers `140000`/`141000`, l'affectation de l'AG étant elle aussi une écriture ultérieure ; UK/US directement en *retained earnings*. Deux champs de pack (`closing_style`, `current_year_result_code`) et une fonction `close_fiscal_year(fy)` couvrent les trois ; la décision d'affectation n'est jamais dans la clôture.

**Le tableau de flux** : quand il viendra, **indirect**, depuis le bilan et le résultat, en s'appuyant sur les types (`asset_cash` isole la trésorerie ; les variations des autres types donnent le BFR). La méthode directe exige de classer chaque paiement, ce que personne ne fait juste. Et personne ne l'exige d'une PME : ni les schémas BNB micro/abrégé, ni la liasse 2050, ni FRS 102 section 1A. Il n'est prérequis de rien avant les États-Unis.

## (f) Ordre d'exécution

1. **Format et compilateur.** Schéma JSON du pack (`packs/schema/pack.1.json`), extraction one-shot des seeds actuels vers `packs/be` et `packs/fr`, `ekwo pack build` et `ekwo pack check` ; les seeds générés remplacent `10_/11_/20_/21_` à contenu identique (un test compare les lignes de templates avant/après).
2. **Migration additive « pack ».** `country_packs`, `company_packs` avec backfill `1.0.0`, `name_i18n`, `companies.language`, seeds en upsert, `install_country_template(…, lang)`.
3. **Cases de déclaration.** `tax_report_templates` + boxes + formules ; `report_code` sur postings et lignes, backfillé ; `vat_return` générique avec `report_code` optionnel ; 71/72 déplacés dans le pack BE ; totaux CA3 ajoutés au pack FR ; `reporting.test.ts` inchangé au centime.
4. **États financiers.** Les trois tables, `financial_statement()`, référentiel générique par type, BNB abrégé/micro et 2050/2051 (bilan, compte de résultat) ; `xbrl_element` renseigné pour BE.
5. **Taxes : colonnes et non-déductibilité.** `tax_kind`, `recoverable`, `jurisdiction`, `price_include` sur templates, `region` sur sociétés et contacts, `tax_on_base` dans `post_document`, `rounding_method`, `cash_rounding_unit`.
6. **TVA sur encaissements et change réalisé.** `cash_basis` + compte d'attente dans `post_document` et `reconcile()` ; écart de change au lettrage sur `fx_gain/fx_loss` ; pack FR corrigé pour les services.
7. **Règles de document, e-invoicing, banque.** Colonnes de `country_defaults`, `legal_mention_templates`, `document_line_items` enrichi des mentions ; rien d'exécutable.
8. **Ouverture et clôture.** `opening_balance(company, fy, lines)` sur le journal `OPN`, `close_fiscal_year(fy)` paramétrée par `closing_style`, écriture de réouverture, `fiscal_years.is_closed` posé par la fonction seulement.
9. **Versionnement et audit.** `audit_log` + triggers, `ekwo pack status` / `upgrade` avec diff et les trois règles, test d'upgrade depuis la version 1.0.0 publiée.
10. **Test doré par pays.** Format `packs/<cc>/golden/` (10 documents, paiements, cases, lignes d'états, balance attendues), runner générique qui itère tous les packs ; BE et FR complétés ; un pack sans golden fait échouer la CI.
11. **Test de bout en bout.** Installation par `ekwo init` et par `supabase db push` + `psql` sur le même pack, `pg_dump --data-only` des templates identique ; installation, upgrade d'un pack, clôture, réouverture, déclaration, sur une instance créée à la version précédente.
12. **Documentation.** `docs/packs.md` (format, « ajouter un pays en une journée », politique de certification), entrées dans `decisions.md`, `schema.md` régénéré, section « Country rules » de `CONTRIBUTING.md` réécrite, `README` des seeds.

Migration BE/FR sans casser : les seeds générés portent les mêmes lignes que les seeds manuels (sous-tâche 1 le prouve) ; les sociétés existantes ne sont touchées par aucune sous-tâche, sauf le backfill de `company_packs` et les deux colonnes de défaut déjà remplies par la migration `193853` ; `config.toml` liste les nouveaux fichiers ; les migrations `121100`, `183000`, `193853` restent intactes et une nouvelle migration remplace les fonctions entières, comme les deux précédentes l'ont fait.

## (g) Risques et garde-fous

**Sur-ingénierie pour une équipe minuscule.** Garde-fous choisis : JSON natif et pas de dépendance ; pas de DSL (deux tableaux et un booléen) ; pas de paquet par pays ; pas de dépôt séparé ; un compilateur d'environ trois cents lignes ; le SQL généré conserve intact le chemin `supabase db push`. Signal d'alerte : si le compilateur dépasse mille lignes ou si le pack gagne un champ que rien ne lit, c'est la règle « garder ou utiliser, jamais au cas où » qui s'applique.

**Divergence entre le pack et les tables.** Le SQL est généré et la CI échoue s'il est périmé (même mécanisme que le test qui épingle la copie des migrations dans le paquet CLI). Un test aller-retour charge le JSON, seed la base, relit les templates et compare. `docs/schema.md` est déjà généré : on n'invente pas de discipline nouvelle.

**Packs communautaires faux.** Le test doré ne suffit pas : une case mal attendue et un posting mal écrit passent ensemble. Trois garde-fous : chaque case et chaque taxe cite sa source légale (`legal_reference`, `sources` du manifeste) ; le manifeste porte `certification.status` et `ekwo init` l'affiche (« pack communautaire, non relu par un comptable ») ; un `CODEOWNERS` par pack et une relecture par un professionnel identifié pour passer à `reviewed`. Ekwo certifie BE et FR ; le reste porte son statut. Coût d'une relecture : une journée de comptable par pack, à budgéter avant chaque pays de phase 1.

**Le piège Odoo.** Odoo localise en code : un `template_be.py`, des hooks, un module par pays lié à une version. Le garde-fou est un test : **aucune fonction du schéma ne contient un code pays** (`select proname from pg_proc where prosrc ~ '''(BE|FR|UK|US)'''` doit être vide après la sous-tâche 3). Si un pays ne s'exprime pas en lignes, c'est une issue de socle, pas une exception dans le pack. Le schéma JSON du pack n'a volontairement aucun champ « script ».

**Un risque non listé : le premier upgrade.** Tant qu'aucune installation n'a reçu deux versions d'un pack, le mécanisme (d) n'a pas été exercé. La sous-tâche 11 doit installer la version 1.0.0 publiée, puis passer à la version courante ; sans ce test, la règle « jamais silencieux » n'est qu'une intention.

## Le cas Canada / Québec : ce que le modèle porte, ce qu'il faut ajouter

François place le Canada et le Québec en phase 1 avant les États-Unis. C'est le bon ordre, et c'est un cas test précis, parce qu'il cumule presque tout ce que l'Europe n'exerce pas, avec une quinzaine de combinaisons de taux stables au lieu des milliers de juridictions américaines. Ce que le pack doit exprimer :

| Situation | Taxes | Récupérable | Administration et déclaration |
|---|---|---|---|
| Alberta, territoires | TPS 5 % | oui (crédit de taxe sur intrants) | ARC, déclaration TPS/TVH (lignes 101, 105, 108, 109) |
| Ontario, N.-B., T.-N.-L., Î.-P.-É., N.-É. | TVH 13 % ou 15 % (N.-É. 14 % depuis avril 2025) | oui | ARC, même déclaration |
| Québec | TPS 5 % **et** TVQ 9,975 %, toutes deux sur le prix hors taxes (plus de cascade depuis 2013) | oui, toutes deux | Revenu Québec administre les deux ; formulaire combiné, deux jeux de lignes (TPS 1xx, TVQ 2xx, à vérifier ligne par ligne) |
| C.-B., Saskatchewan, Manitoba | TPS 5 % **et** PST 7 %, 6 %, 7 % | TPS oui, PST **non** (charge) | ARC pour la TPS, ministère provincial pour la PST, déclaration distincte |

**Ce que `tax_postings` porte déjà, sans rien changer** : une taxe seule, TPS ou TVH, avec son compte de passif, son compte de crédit à l'achat et ses cases ; la validité temporelle (la baisse néo-écossaise est un `valid_to` plus une nouvelle taxe) ; la PST en achat, dès que `tax_on_base` (phase 0) existe, puisque la taxe non récupérable rejoint le compte de la ligne ; la PST en vente, comme n'importe quelle taxe collectée. Le plan de comptes sans norme légale, les libellés bilingues (`name_i18n` fr/en, langue choisie par société et non par pack, ce qui règle aussi la Charte de la langue française pour un client québécois), l'exercice décalé et l'absence de facturation électronique obligatoire (`einvoice_profile` nul) sont tous couverts par le format retenu. Les états financiers sont le référentiel générique par type, étiqueté ASPE.

**Ce que le modèle ne porte pas, en trois points, tous additifs :**

1. **Deux taxes sur une ligne** (TPS + TVQ, TPS + PST). `document_lines.tax_id` est scalaire, et c'est bien. La réponse est la **taxe de groupe** : `tax_amount_type` gagne `group`, une table `tax_group_members(group_tax_id, member_tax_id, sequence)`, et `post_document` développe le groupe en ses membres, chacun avec ses propres postings, son compte et ses cases. Le pack CA livre « QC TPS+TVQ 14,975 % » comme un code unique, ce que le comptable québécois attend de QuickBooks et de Sage 50. La vue `document_tax_summary` sort une ligne par membre, ce que la facture québécoise exige (les deux montants et les deux numéros d'inscription).
2. **Une ligne de base qui alimente deux cases** (la vente québécoise nourrit la ligne 101 de la TPS et la ligne 201 de la TVQ). `entry_lines.declaration_box` est une colonne scalaire. Il faut une table **`entry_line_boxes(entry_line_id, company_id, report_code, box, amount)`**, c'est-à-dire exactement le `tax_tag_ids` d'Odoo. Migration : backfill depuis les colonnes, `post_document` n'écrit plus que la table, `vat_return` la lit, et les deux colonnes restent publiées mais ne sont plus écrites, documentées comme dépréciées. C'est le seul point de la phase 1 CA qui touche le socle en profondeur ; il justifie d'introduire `report_code` dès la phase 0 pour ne pas migrer deux fois.
3. **Le choix de la taxe dépend de la province du client**, pas du vendeur (lieu de fourniture). Le socle ne choisit délibérément aucune taxe ; il peut en *suggérer* une. Phase 0 : `region` sur `companies` et `contacts`. Phase 1 CA : une table déclarative de pack `tax_rule_templates(country, buyer_region, buyer_country_kind, scope, tax_code)`, l'équivalent des positions fiscales d'Odoo, et une fonction `suggest_tax(company, contact, scope)` que le client peut ignorer. Il faut aussi `tax_registrations(company_id, jurisdiction, number)` pour porter le numéro TPS et le numéro TVQ, là où `companies.vat_number` n'en porte qu'un ; ce sera utile à toute société européenne immatriculée dans un second pays.

**Taux dans le pack, pas dans la couche commerciale.** L'arbitrage « formulaire dans le socle, taux en couche commerciale » vaut pour les États-Unis, où les taux sont des milliers et changent chaque mois. Le Canada a une quinzaine de combinaisons, stables, publiées par l'ARC : elles vont dans `packs/ca/taxes.json`, et le test doré canadien poste une vente en Ontario, une au Québec, un achat en Colombie-Britannique.

Rien de ceci ne change le format du pack ; cela ajoute deux colonnes en phase 0 et trois tables en phase 1. Le pilote de Saint-Jean-Baptiste concerne la plateforme énergie et non la comptabilité, mais il fixe une contrainte utile : la documentation du pack CA et l'installateur doivent exister en français dès le premier jour.

## (h) Sources

- Ekwo : `README.md`, `docs/decisions.md`, `docs/mapping.md`, `supabase/seed/README.md`, `tests/README.md`, `CONTRIBUTING.md`, migrations `20260911121100`, `183000`, `193853`, `121000` (`vat_return`), seeds `10_chart_be.sql`, `20_taxes_be.sql`, `21_taxes_fr.sql`, `tests/seeds.test.ts`.
- Odoo 18, structure d'une localisation : [`l10n_be/data/template/`](https://github.com/odoo/odoo/tree/18.0/addons/l10n_be/data/template) (`account.account-be.csv`, `account.tax-be.csv`, `account.group-be.csv`, `account.fiscal.position-be.csv`), [Accounting localization how-to](https://www.odoo.com/documentation/18.0/developer/howtos/accounting_localization.html) (décorateur `@template`, `account.report`).
- Xero, [Import a chart of accounts](https://central.xero.com/s/article/Import-a-chart-of-accounts) (CSV `*Code, *Name, *Type, *Tax Code`).
- GnuCash, [Account Hierarchy Template](https://wiki.gnucash.org/wiki/Account_Hierarchy_Template) (`.gnucash-xea` XML par locale).
- FRC, [2026 Taxonomy Suite](https://www.frc.org.uk/library/standards-codes-policy/accounting-and-reporting/frc-taxonomies/current-frc-taxonomy-suites/2026-frc-taxonomy-suite/) (FRS 102, iXBRL Companies House).
- Peppol PINT : [docs.peppol.eu/poacc/pint](https://docs.peppol.eu/poacc/pint/) — spécialisations PINT-JP, PINT-AU/NZ, PINT-SG, PINT-MY ; la page exacte n'a pas pu être rechargée aujourd'hui, à re-vérifier avant d'écrire le champ `einvoice_profile`.
- Rapports ST5 (`st5-odoo.md`) et ST6 (`st6-supabase.md`) du 11 septembre 2026.
- Canada : taux TPS/TVH par province et lignes 101/105/108/109 de la déclaration TPS/TVH (ARC) ; TVQ 9,975 % sur le prix hors TPS depuis le 1er janvier 2013 et TVH N.-É. à 14 % depuis le 1er avril 2025, de mémoire, à confirmer sur canada.ca et revenuquebec.ca avant d'écrire `packs/ca/taxes.json` ; numéros de lignes de la déclaration TVQ non vérifiés.

## Ce que je ferais différemment du plan de François

- La TVA sur les encaissements passe avant le Royaume-Uni : c'est un défaut du pack FR d'aujourd'hui, pas une option UK.
- Les exercices décalés et 52-53 semaines sortent du plan : `fiscal_years` les couvre déjà.
- La balance d'ouverture devient le premier item du chantier 2, parce qu'elle bloque l'adoption en BE et FR avant tout pays.
- Le tableau de flux quitte la phase 0 ; quand il viendra, il sera indirect.
- Le moteur de taxe se coupe en deux : non-déductibilité, `report_code` et `region` maintenant ; taxe de groupe et cases multiples par ligne avec le pack Canada.
- Les taux canadiens vont dans le pack ; seuls les taux américains relèvent de la couche commerciale.
- Pas de paquet npm par pays et pas de YAML : JSON plus CSV, compilés en SQL committé.
- Les seeds passent en upsert, sinon même une nouvelle société sur une vieille instance reçoit le vieux pack.
- Le journal d'audit se fait maintenant, par triggers, en trente lignes, parce que l'upgrade de pack doit y écrire.
- En phase 1, l'Irlande suit immédiatement le Royaume-Uni (même structure, EUR), le Canada précède les États-Unis comme François le demande, et l'Allemagne vient en dernier (deux plans SKR, UStVA, XRechnung + ZUGFeRD, GoBD).

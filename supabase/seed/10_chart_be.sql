-- Ekwo OS — Belgium: chart of accounts, journals and defaults.
--
-- Source: plan comptable minimum normalisé (PCMN), annexe 1 de l'arrêté royal
-- du 21 octobre 2018 portant exécution des articles III.82 à III.95 du Code de
-- droit économique.
--
-- Scope: classes 1 to 7 at group level (two- and three-digit headers) plus the
-- six-digit detail accounts a Belgian SRL/SA actually books to. Reference data:
-- `install_country_template()` copies it into a company, nothing here belongs
-- to a company.

insert into account_templates (country, code, name, account_type, reconcilable, parent_code, sequence) values
  -- =======================================================================
  -- Classe 1 — Fonds propres, provisions pour risques et charges et dettes
  --            à plus d'un an
  -- =======================================================================
  ('BE', '10',       'Capital',                                                     'equity',                false, null    , 10),
  ('BE', '100',      'Capital souscrit',                                            'equity',                false, '10'    , 20),
  ('BE', '100000',   'Capital souscrit',                                            'equity',                false, '100'   , 30),
  ('BE', '101',      'Capital non appelé',                                          'equity',                false, '10'    , 40),

  ('BE', '11',       'Primes d''émission',                                          'equity',                false, null    , 50),
  ('BE', '110',      'Primes d''émission',                                          'equity',                false, '11'    , 60),
  ('BE', '110000',   'Primes d''émission',                                          'equity',                false, '110'   , 70),

  ('BE', '12',       'Plus-values de réévaluation',                                 'equity',                false, null    , 80),
  ('BE', '120',      'Plus-values de réévaluation sur immobilisations corporelles', 'equity',                false, '12'    , 90),

  ('BE', '13',       'Réserves',                                                    'equity',                false, null    , 100),
  ('BE', '130',      'Réserve légale',                                              'equity',                false, '13'    , 110),
  ('BE', '130000',   'Réserve légale',                                              'equity',                false, '130'   , 120),
  ('BE', '131',      'Réserves indisponibles',                                      'equity',                false, '13'    , 130),
  ('BE', '131000',   'Réserves indisponibles',                                      'equity',                false, '131'   , 140),
  ('BE', '133',      'Réserves disponibles',                                        'equity',                false, '13'    , 150),
  ('BE', '133000',   'Réserves disponibles',                                        'equity',                false, '133'   , 160),

  ('BE', '14',       'Bénéfice (perte) reporté(e)',                                 'equity_retained',       false, null    , 170),
  ('BE', '140',      'Bénéfice reporté',                                            'equity_retained',       false, '14'    , 180),
  ('BE', '140000',   'Bénéfice reporté',                                            'equity_retained',       false, '140'   , 190),
  ('BE', '141',      'Perte reportée',                                              'equity_retained',       false, '14'    , 200),
  ('BE', '141000',   'Perte reportée',                                              'equity_retained',       false, '141'   , 210),

  ('BE', '15',       'Subsides en capital',                                         'liability_current',     false, null    , 220),
  ('BE', '150',      'Subsides en capital',                                         'liability_current',     false, '15'    , 230),

  ('BE', '16',       'Provisions pour risques et charges et impôts différés',       'liability_non_current', false, null    , 240),
  ('BE', '160',      'Provisions pour pensions et obligations similaires',          'liability_non_current', false, '16'    , 250),
  ('BE', '161',      'Provisions pour charges fiscales',                            'liability_non_current', false, '16'    , 260),
  ('BE', '162',      'Provisions pour grosses réparations et gros entretiens',      'liability_non_current', false, '16'    , 270),
  ('BE', '163',      'Provisions pour autres risques et charges',                   'liability_non_current', false, '16'    , 280),
  ('BE', '163000',   'Provisions pour autres risques et charges',                   'liability_non_current', false, '163'   , 290),

  ('BE', '17',       'Dettes à plus d''un an',                                      'liability_non_current', false, null    , 300),
  ('BE', '170',      'Emprunts subordonnés',                                        'liability_non_current', false, '17'    , 310),
  ('BE', '172',      'Emprunts obligataires non subordonnés',                       'liability_non_current', false, '17'    , 320),
  ('BE', '173',      'Établissements de crédit',                                    'liability_non_current', false, '17'    , 330),
  ('BE', '173000',   'Emprunts bancaires à plus d''un an',                          'liability_non_current', false, '173'   , 340),
  ('BE', '173100',   'Dettes de location-financement',                              'liability_non_current', false, '173'   , 350),
  ('BE', '174',      'Autres emprunts',                                             'liability_non_current', false, '17'    , 360),
  ('BE', '174000',   'Autres emprunts',                                             'liability_non_current', false, '174'   , 370),
  ('BE', '175',      'Dettes commerciales à plus d''un an',                         'liability_non_current', false, '17'    , 380),
  ('BE', '178',      'Cautionnements reçus en numéraire',                           'liability_non_current', false, '17'    , 390),
  ('BE', '179',      'Dettes diverses à plus d''un an',                             'liability_non_current', false, '17'    , 400),
  ('BE', '179000',   'Compte courant des associés à plus d''un an',                 'liability_non_current', false, '179'   , 410),

  -- =======================================================================
  -- Classe 2 — Frais d'établissement, actifs immobilisés et créances à plus
  --            d'un an
  -- =======================================================================
  ('BE', '20',       'Frais d''établissement',                                      'asset_fixed',           false, null    , 420),
  ('BE', '200',      'Frais de constitution et d''augmentation de capital',         'asset_fixed',           false, '20'    , 430),
  ('BE', '200000',   'Frais de constitution',                                       'asset_fixed',           false, '200'   , 440),
  ('BE', '200900',   'Amortissements sur frais d''établissement',                   'asset_fixed',           false, '200'   , 450),

  ('BE', '21',       'Immobilisations incorporelles',                               'asset_fixed',           false, null    , 460),
  ('BE', '210',      'Frais de recherche et de développement',                      'asset_fixed',           false, '21'    , 470),
  ('BE', '210000',   'Frais de recherche et de développement',                      'asset_fixed',           false, '210'   , 480),
  ('BE', '210900',   'Amortissements sur frais de recherche et de développement',   'asset_fixed',           false, '210'   , 490),
  ('BE', '211',      'Concessions, brevets, licences, savoir-faire et marques',     'asset_fixed',           false, '21'    , 500),
  ('BE', '211000',   'Concessions, brevets, licences et logiciels',                 'asset_fixed',           false, '211'   , 510),
  ('BE', '211900',   'Amortissements sur concessions, brevets et logiciels',        'asset_fixed',           false, '211'   , 520),
  ('BE', '212',      'Goodwill',                                                    'asset_fixed',           false, '21'    , 530),

  ('BE', '22',       'Terrains et constructions',                                   'asset_fixed',           false, null    , 540),
  ('BE', '220',      'Terrains',                                                    'asset_fixed',           false, '22'    , 550),
  ('BE', '220000',   'Terrains',                                                    'asset_fixed',           false, '220'   , 560),
  ('BE', '221',      'Constructions',                                               'asset_fixed',           false, '22'    , 570),
  ('BE', '221000',   'Constructions',                                               'asset_fixed',           false, '221'   , 580),
  ('BE', '221900',   'Amortissements sur constructions',                            'asset_fixed',           false, '221'   , 590),
  ('BE', '223',      'Autres droits réels sur immeubles',                           'asset_fixed',           false, '22'    , 600),

  ('BE', '23',       'Installations, machines et outillage',                        'asset_fixed',           false, null    , 610),
  ('BE', '230',      'Installations',                                               'asset_fixed',           false, '23'    , 620),
  ('BE', '230000',   'Installations',                                               'asset_fixed',           false, '230'   , 630),
  ('BE', '230900',   'Amortissements sur installations',                            'asset_fixed',           false, '230'   , 640),
  ('BE', '231',      'Machines',                                                    'asset_fixed',           false, '23'    , 650),
  ('BE', '231000',   'Machines',                                                    'asset_fixed',           false, '231'   , 660),
  ('BE', '231900',   'Amortissements sur machines',                                 'asset_fixed',           false, '231'   , 670),
  ('BE', '233',      'Outillage',                                                   'asset_fixed',           false, '23'    , 680),
  ('BE', '233000',   'Outillage',                                                   'asset_fixed',           false, '233'   , 690),
  ('BE', '233900',   'Amortissements sur outillage',                                'asset_fixed',           false, '233'   , 700),

  ('BE', '24',       'Mobilier et matériel roulant',                                'asset_fixed',           false, null    , 710),
  ('BE', '240',      'Mobilier',                                                    'asset_fixed',           false, '24'    , 720),
  ('BE', '240000',   'Mobilier',                                                    'asset_fixed',           false, '240'   , 730),
  ('BE', '240900',   'Amortissements sur mobilier',                                 'asset_fixed',           false, '240'   , 740),
  ('BE', '241',      'Matériel de bureau et matériel informatique',                 'asset_fixed',           false, '24'    , 750),
  ('BE', '241000',   'Matériel de bureau et matériel informatique',                 'asset_fixed',           false, '241'   , 760),
  ('BE', '241900',   'Amortissements sur matériel de bureau et informatique',       'asset_fixed',           false, '241'   , 770),
  ('BE', '242',      'Matériel roulant',                                            'asset_fixed',           false, '24'    , 780),
  ('BE', '242000',   'Matériel roulant',                                            'asset_fixed',           false, '242'   , 790),
  ('BE', '242900',   'Amortissements sur matériel roulant',                         'asset_fixed',           false, '242'   , 800),

  ('BE', '25',       'Immobilisations détenues en location-financement',            'asset_fixed',           false, null    , 810),
  ('BE', '252',      'Mobilier et matériel roulant en location-financement',        'asset_fixed',           false, '25'    , 820),
  ('BE', '252000',   'Mobilier et matériel roulant en location-financement',        'asset_fixed',           false, '252'   , 830),
  ('BE', '252900',   'Amortissements sur immobilisations en location-financement',  'asset_fixed',           false, '252'   , 840),

  ('BE', '26',       'Autres immobilisations corporelles',                          'asset_fixed',           false, null    , 850),
  ('BE', '260',      'Frais d''aménagement de locaux pris en location',             'asset_fixed',           false, '26'    , 860),
  ('BE', '260000',   'Frais d''aménagement de locaux pris en location',             'asset_fixed',           false, '260'   , 870),
  ('BE', '260900',   'Amortissements sur frais d''aménagement de locaux',           'asset_fixed',           false, '260'   , 880),
  ('BE', '261',      'Autres immobilisations corporelles',                          'asset_fixed',           false, '26'    , 890),

  ('BE', '27',       'Immobilisations corporelles en cours et acomptes versés',     'asset_fixed',           false, null    , 900),
  ('BE', '270',      'Immobilisations en cours',                                    'asset_fixed',           false, '27'    , 910),
  ('BE', '270000',   'Immobilisations en cours',                                    'asset_fixed',           false, '270'   , 920),

  ('BE', '28',       'Immobilisations financières',                                 'asset_non_current',     false, null    , 930),
  ('BE', '280',      'Participations dans des entreprises liées',                   'asset_non_current',     false, '28'    , 940),
  ('BE', '280000',   'Participations dans des entreprises liées',                   'asset_non_current',     false, '280'   , 950),
  ('BE', '284',      'Actions et parts dans d''autres entreprises',                 'asset_non_current',     false, '28'    , 960),
  ('BE', '288',      'Cautionnements versés en numéraire',                          'asset_non_current',     false, '28'    , 970),
  ('BE', '288000',   'Cautionnements versés en numéraire',                          'asset_non_current',     false, '288'   , 980),

  ('BE', '29',       'Créances à plus d''un an',                                    'asset_non_current',     false, null    , 990),
  ('BE', '290',      'Créances commerciales à plus d''un an',                       'asset_non_current',     false, '29'    , 1000),
  ('BE', '295',      'Autres créances à plus d''un an',                             'asset_non_current',     false, '29'    , 1010),
  ('BE', '295000',   'Autres créances à plus d''un an',                             'asset_non_current',     false, '295'   , 1020),

  -- =======================================================================
  -- Classe 3 — Stocks et commandes en cours d'exécution
  -- =======================================================================
  ('BE', '30',       'Approvisionnements — matières premières',                     'asset_current',         false, null    , 1030),
  ('BE', '300',      'Matières premières',                                          'asset_current',         false, '30'    , 1040),
  ('BE', '300000',   'Matières premières',                                          'asset_current',         false, '300'   , 1050),

  ('BE', '31',       'Approvisionnements — fournitures',                            'asset_current',         false, null    , 1060),
  ('BE', '310',      'Fournitures',                                                 'asset_current',         false, '31'    , 1070),

  ('BE', '32',       'En-cours de fabrication',                                     'asset_current',         false, null    , 1080),

  ('BE', '33',       'Produits finis',                                              'asset_current',         false, null    , 1090),
  ('BE', '330',      'Produits finis',                                              'asset_current',         false, '33'    , 1100),

  ('BE', '34',       'Marchandises',                                                'asset_current',         false, null    , 1110),
  ('BE', '340',      'Marchandises',                                                'asset_current',         false, '34'    , 1120),
  ('BE', '340000',   'Marchandises',                                                'asset_current',         false, '340'   , 1130),
  ('BE', '340900',   'Réductions de valeur sur marchandises',                       'asset_current',         false, '340'   , 1140),

  ('BE', '35',       'Immeubles destinés à la vente',                               'asset_current',         false, null    , 1150),

  ('BE', '36',       'Acomptes versés sur achats pour stocks',                      'asset_current',         false, null    , 1160),

  ('BE', '37',       'Commandes en cours d''exécution',                             'asset_current',         false, null    , 1170),
  ('BE', '370',      'Commandes en cours d''exécution',                             'asset_current',         false, '37'    , 1180),
  ('BE', '370000',   'Commandes en cours d''exécution',                             'asset_current',         false, '370'   , 1190),

  -- =======================================================================
  -- Classe 4 — Créances et dettes à un an au plus
  -- =======================================================================
  ('BE', '40',       'Créances commerciales',                                       'asset_receivable',      true , null    , 1200),
  ('BE', '400',      'Clients',                                                     'asset_receivable',      true , '40'    , 1210),
  ('BE', '400000',   'Clients',                                                     'asset_receivable',      true , '400'   , 1220),
  ('BE', '401',      'Effets à recevoir',                                           'asset_current',         false, '40'    , 1230),
  ('BE', '404',      'Produits à recevoir',                                         'asset_current',         false, '40'    , 1240),
  ('BE', '404000',   'Factures à établir',                                          'asset_current',         false, '404'   , 1250),
  ('BE', '406',      'Acomptes versés',                                             'asset_current',         false, '40'    , 1260),
  ('BE', '406000',   'Acomptes versés sur commandes',                               'asset_current',         false, '406'   , 1270),
  ('BE', '407',      'Créances douteuses',                                          'asset_current',         false, '40'    , 1280),
  ('BE', '407000',   'Créances douteuses',                                          'asset_current',         false, '407'   , 1290),
  ('BE', '409',      'Réductions de valeur actées sur créances commerciales',       'asset_current',         false, '40'    , 1300),
  ('BE', '409000',   'Réductions de valeur actées sur créances commerciales',       'asset_current',         false, '409'   , 1310),

  ('BE', '41',       'Autres créances',                                             'asset_current',         false, null    , 1320),
  ('BE', '411',      'TVA à récupérer',                                             'asset_current',         false, '41'    , 1330),
  ('BE', '411000',   'TVA à récupérer',                                             'asset_current',         false, '411'   , 1340),
  ('BE', '411100',   'TVA déductible sur achats',                                   'asset_current',         false, '411'   , 1350),
  ('BE', '412',      'Impôts et versements fiscaux à récupérer',                    'asset_current',         false, '41'    , 1360),
  ('BE', '412000',   'Impôts et versements fiscaux à récupérer',                    'asset_current',         false, '412'   , 1370),
  ('BE', '414',      'Produits à recevoir',                                         'asset_current',         false, '41'    , 1380),
  ('BE', '414000',   'Produits à recevoir',                                         'asset_current',         false, '414'   , 1390),
  ('BE', '416',      'Créances diverses',                                           'asset_current',         false, '41'    , 1400),
  ('BE', '416000',   'Créances diverses',                                           'asset_current',         false, '416'   , 1410),
  ('BE', '416100',   'Compte courant des administrateurs et gérants',               'asset_current',         false, '416'   , 1420),
  ('BE', '418',      'Cautionnements versés en numéraire',                          'asset_current',         false, '41'    , 1430),
  ('BE', '418000',   'Cautionnements versés en numéraire',                          'asset_current',         false, '418'   , 1440),

  ('BE', '42',       'Dettes à plus d''un an échéant dans l''année',                'liability_current',     false, null    , 1450),
  ('BE', '423',      'Établissements de crédit',                                    'liability_current',     false, '42'    , 1460),
  ('BE', '423000',   'Emprunts bancaires échéant dans l''année',                    'liability_current',     false, '423'   , 1470),
  ('BE', '423100',   'Dettes de location-financement échéant dans l''année',        'liability_current',     false, '423'   , 1480),
  ('BE', '424',      'Autres emprunts',                                             'liability_current',     false, '42'    , 1490),

  ('BE', '43',       'Dettes financières',                                          'liability_current',     false, null    , 1500),
  ('BE', '430',      'Établissements de crédit — dettes en compte courant',         'liability_current',     false, '43'    , 1510),
  ('BE', '430000',   'Établissements de crédit — dettes en compte courant',         'liability_current',     false, '430'   , 1520),
  ('BE', '439',      'Autres emprunts à un an au plus',                             'liability_current',     false, '43'    , 1530),

  ('BE', '44',       'Dettes commerciales',                                         'liability_payable',     true , null    , 1540),
  ('BE', '440',      'Fournisseurs',                                                'liability_payable',     true , '44'    , 1550),
  ('BE', '440000',   'Fournisseurs',                                                'liability_payable',     true , '440'   , 1560),
  ('BE', '441',      'Effets à payer',                                              'liability_current',     false, '44'    , 1570),
  ('BE', '444',      'Factures à recevoir',                                         'liability_current',     false, '44'    , 1580),
  ('BE', '444000',   'Factures à recevoir',                                         'liability_current',     false, '444'   , 1590),

  ('BE', '45',       'Dettes fiscales, salariales et sociales',                     'liability_current',     false, null    , 1600),
  ('BE', '450',      'Dettes fiscales estimées',                                    'liability_current',     false, '45'    , 1610),
  ('BE', '450000',   'Dettes fiscales estimées',                                    'liability_current',     false, '450'   , 1620),
  ('BE', '451',      'TVA à payer',                                                 'liability_current',     false, '45'    , 1630),
  ('BE', '451000',   'TVA à payer',                                                 'liability_current',     false, '451'   , 1640),
  ('BE', '451100',   'TVA due sur ventes',                                          'liability_current',     false, '451'   , 1650),
  ('BE', '451200',   'TVA due — cocontractant et report de perception',             'liability_current',     false, '451'   , 1660),
  ('BE', '452',      'Impôts et taxes à payer',                                     'liability_current',     false, '45'    , 1670),
  ('BE', '452000',   'Impôts et taxes à payer',                                     'liability_current',     false, '452'   , 1680),
  ('BE', '453',      'Précomptes retenus',                                          'liability_current',     false, '45'    , 1690),
  ('BE', '453000',   'Précompte professionnel à payer',                             'liability_current',     false, '453'   , 1700),
  ('BE', '454',      'Office national de la sécurité sociale',                      'liability_current',     false, '45'    , 1710),
  ('BE', '454000',   'ONSS à payer',                                                'liability_current',     false, '454'   , 1720),
  ('BE', '455',      'Rémunérations',                                               'liability_current',     false, '45'    , 1730),
  ('BE', '455000',   'Rémunérations à payer',                                       'liability_current',     false, '455'   , 1740),
  ('BE', '456',      'Pécules de vacances',                                         'liability_current',     false, '45'    , 1750),
  ('BE', '456000',   'Pécules de vacances à payer',                                 'liability_current',     false, '456'   , 1760),
  ('BE', '459',      'Autres dettes sociales',                                      'liability_current',     false, '45'    , 1770),
  ('BE', '459000',   'Autres dettes sociales',                                      'liability_current',     false, '459'   , 1780),

  ('BE', '46',       'Acomptes reçus sur commandes',                                'liability_current',     false, null    , 1790),
  ('BE', '460',      'Acomptes reçus sur commandes',                                'liability_current',     false, '46'    , 1800),
  ('BE', '460000',   'Acomptes reçus sur commandes',                                'liability_current',     false, '460'   , 1810),

  ('BE', '47',       'Dettes découlant de l''affectation des résultats',            'liability_current',     false, null    , 1820),
  ('BE', '471',      'Dividendes de l''exercice',                                   'liability_current',     false, '47'    , 1830),
  ('BE', '471000',   'Dividendes de l''exercice',                                   'liability_current',     false, '471'   , 1840),
  ('BE', '472',      'Tantièmes de l''exercice',                                    'liability_current',     false, '47'    , 1850),

  ('BE', '48',       'Dettes diverses',                                             'liability_current',     false, null    , 1860),
  ('BE', '489',      'Autres dettes diverses',                                      'liability_current',     false, '48'    , 1870),
  ('BE', '489000',   'Autres dettes diverses',                                      'liability_current',     false, '489'   , 1880),
  ('BE', '489100',   'Compte courant des administrateurs et gérants',               'liability_current',     false, '489'   , 1890),

  ('BE', '49',       'Comptes de régularisation et comptes d''attente',             'liability_current',     false, null    , 1900),
  ('BE', '490',      'Charges à reporter',                                          'asset_prepayments',     false, '49'    , 1910),
  ('BE', '490000',   'Charges à reporter',                                          'asset_prepayments',     false, '490'   , 1920),
  ('BE', '491',      'Produits acquis',                                             'asset_prepayments',     false, '49'    , 1930),
  ('BE', '491000',   'Produits acquis',                                             'asset_prepayments',     false, '491'   , 1940),
  ('BE', '492',      'Charges à imputer',                                           'liability_current',     false, '49'    , 1950),
  ('BE', '492000',   'Charges à imputer',                                           'liability_current',     false, '492'   , 1960),
  ('BE', '493',      'Produits à reporter',                                         'liability_current',     false, '49'    , 1970),
  ('BE', '493000',   'Produits à reporter',                                         'liability_current',     false, '493'   , 1980),
  ('BE', '499',      'Comptes d''attente',                                          'liability_current',     false, '49'    , 1990),
  ('BE', '499000',   'Compte d''attente',                                           'liability_current',     false, '499'   , 2000),

  -- =======================================================================
  -- Classe 5 — Placements de trésorerie et valeurs disponibles
  -- =======================================================================
  ('BE', '50',       'Actions propres',                                             'asset_current',         false, null    , 2010),

  ('BE', '51',       'Actions et parts',                                            'asset_current',         false, null    , 2020),

  ('BE', '52',       'Titres à revenu fixe',                                        'asset_current',         false, null    , 2030),

  ('BE', '53',       'Dépôts à terme',                                              'asset_current',         false, null    , 2040),
  ('BE', '530',      'Dépôts à plus d''un mois',                                    'asset_current',         false, '53'    , 2050),
  ('BE', '530000',   'Dépôts à plus d''un mois',                                    'asset_current',         false, '530'   , 2060),

  ('BE', '54',       'Valeurs échues à l''encaissement',                            'asset_current',         false, null    , 2070),
  ('BE', '540',      'Valeurs échues à l''encaissement',                            'asset_current',         false, '54'    , 2080),
  ('BE', '540000',   'Chèques et effets à encaisser',                               'asset_current',         false, '540'   , 2090),

  ('BE', '55',       'Établissements de crédit',                                    'asset_cash',            false, null    , 2100),
  ('BE', '550',      'Banque — comptes courants',                                   'asset_cash',            false, '55'    , 2110),
  ('BE', '550000',   'Banque — compte courant',                                     'asset_cash',            false, '550'   , 2120),
  ('BE', '550100',   'Banque — deuxième compte courant',                            'asset_cash',            false, '550'   , 2130),
  ('BE', '552',      'Comptes d''épargne',                                          'asset_cash',            false, '55'    , 2140),
  ('BE', '552000',   'Compte d''épargne',                                           'asset_cash',            false, '552'   , 2150),

  ('BE', '57',       'Caisses',                                                     'asset_cash',            false, null    , 2160),
  ('BE', '570',      'Caisses — espèces',                                           'asset_cash',            false, '57'    , 2170),
  ('BE', '570000',   'Caisse',                                                      'asset_cash',            false, '570'   , 2180),

  ('BE', '58',       'Virements internes',                                          'asset_current',         false, null    , 2190),
  ('BE', '580',      'Virements internes',                                          'asset_current',         false, '58'    , 2200),
  ('BE', '580000',   'Virements internes',                                          'asset_current',         false, '580'   , 2210),

  -- =======================================================================
  -- Classe 6 — Charges
  -- =======================================================================
  ('BE', '60',       'Approvisionnements et marchandises',                          'expense_direct_cost',   false, null    , 2220),
  ('BE', '600',      'Achats de matières premières',                                'expense_direct_cost',   false, '60'    , 2230),
  ('BE', '600000',   'Achats de matières premières',                                'expense_direct_cost',   false, '600'   , 2240),
  ('BE', '601',      'Achats de fournitures',                                       'expense_direct_cost',   false, '60'    , 2250),
  ('BE', '602',      'Achats de services, travaux et études',                       'expense_direct_cost',   false, '60'    , 2260),
  ('BE', '602000',   'Achats de services, travaux et études',                       'expense_direct_cost',   false, '602'   , 2270),
  ('BE', '603',      'Sous-traitances générales',                                   'expense_direct_cost',   false, '60'    , 2280),
  ('BE', '603000',   'Sous-traitances générales',                                   'expense_direct_cost',   false, '603'   , 2290),
  ('BE', '604',      'Achats de marchandises',                                      'expense_direct_cost',   false, '60'    , 2300),
  ('BE', '604000',   'Achats de marchandises',                                      'expense_direct_cost',   false, '604'   , 2310),
  ('BE', '608',      'Remises, ristournes et rabais obtenus',                       'expense_direct_cost',   false, '60'    , 2320),
  ('BE', '608000',   'Remises, ristournes et rabais obtenus',                       'expense_direct_cost',   false, '608'   , 2330),
  ('BE', '609',      'Variation des stocks',                                        'expense_direct_cost',   false, '60'    , 2340),
  ('BE', '609000',   'Variation des stocks de marchandises',                        'expense_direct_cost',   false, '609'   , 2350),

  ('BE', '61',       'Services et biens divers',                                    'expense',               false, null    , 2360),
  ('BE', '610',      'Loyers et charges locatives',                                 'expense',               false, '61'    , 2370),
  ('BE', '610000',   'Loyers et charges locatives',                                 'expense',               false, '610'   , 2380),
  ('BE', '610100',   'Charges locatives',                                           'expense',               false, '610'   , 2390),
  ('BE', '611',      'Entretien et réparations',                                    'expense',               false, '61'    , 2400),
  ('BE', '611000',   'Entretien et réparations',                                    'expense',               false, '611'   , 2410),
  ('BE', '612',      'Fournitures faites à l''entreprise',                          'expense',               false, '61'    , 2420),
  ('BE', '612000',   'Eau, gaz, électricité et chauffage',                          'expense',               false, '612'   , 2430),
  ('BE', '612100',   'Téléphone, internet et communications',                       'expense',               false, '612'   , 2440),
  ('BE', '612200',   'Fournitures de bureau et imprimés',                           'expense',               false, '612'   , 2450),
  ('BE', '612400',   'Logiciels et abonnements informatiques',                      'expense',               false, '612'   , 2460),
  ('BE', '613',      'Rétributions de tiers',                                       'expense',               false, '61'    , 2470),
  ('BE', '613000',   'Honoraires et prestations de tiers',                          'expense',               false, '613'   , 2480),
  ('BE', '613100',   'Assurances non relatives au personnel',                       'expense',               false, '613'   , 2490),
  ('BE', '613200',   'Redevances, licences et royalties',                           'expense',               false, '613'   , 2500),
  ('BE', '614',      'Annonces, publicité, propagande et documentation',            'expense',               false, '61'    , 2510),
  ('BE', '614000',   'Publicité et annonces',                                       'expense',               false, '614'   , 2520),
  ('BE', '615',      'Transports et déplacements',                                  'expense',               false, '61'    , 2530),
  ('BE', '615000',   'Frais de déplacement et de séjour',                           'expense',               false, '615'   , 2540),
  ('BE', '615100',   'Frais de voiture — carburant et entretien',                   'expense',               false, '615'   , 2550),
  ('BE', '615200',   'Frais de restaurant et de réception',                         'expense',               false, '615'   , 2560),
  ('BE', '617',      'Personnel intérimaire et personnes mises à la disposition de l''entreprise', 'expense',               false, '61'    , 2570),
  ('BE', '618',      'Rémunérations et pensions des administrateurs et gérants non salariés', 'expense',               false, '61'    , 2580),
  ('BE', '618000',   'Rémunération du dirigeant d''entreprise indépendant',         'expense',               false, '618'   , 2590),

  ('BE', '62',       'Rémunérations, charges sociales et pensions',                 'expense',               false, null    , 2600),
  ('BE', '620',      'Rémunérations et avantages sociaux directs',                  'expense',               false, '62'    , 2610),
  ('BE', '620000',   'Rémunérations',                                               'expense',               false, '620'   , 2620),
  ('BE', '620300',   'Pécule de vacances',                                          'expense',               false, '620'   , 2630),
  ('BE', '621',      'Cotisations patronales d''assurances sociales',               'expense',               false, '62'    , 2640),
  ('BE', '621000',   'Cotisations patronales ONSS',                                 'expense',               false, '621'   , 2650),
  ('BE', '622',      'Primes patronales pour assurances extralégales',              'expense',               false, '62'    , 2660),
  ('BE', '623',      'Autres frais de personnel',                                   'expense',               false, '62'    , 2670),
  ('BE', '623000',   'Autres frais de personnel',                                   'expense',               false, '623'   , 2680),
  ('BE', '623100',   'Assurance-loi et médecine du travail',                        'expense',               false, '623'   , 2690),
  ('BE', '623200',   'Chèques-repas et avantages non récurrents',                   'expense',               false, '623'   , 2700),
  ('BE', '623300',   'Secrétariat social et gestion du personnel',                  'expense',               false, '623'   , 2710),
  ('BE', '624',      'Pensions de retraite et de survie',                           'expense',               false, '62'    , 2720),

  ('BE', '63',       'Amortissements, réductions de valeur et provisions pour risques et charges', 'expense_depreciation',  false, null    , 2730),
  ('BE', '630',      'Dotations aux amortissements et aux réductions de valeur sur immobilisations', 'expense_depreciation',  false, '63'    , 2740),
  ('BE', '630000',   'Dotations aux amortissements',                                'expense_depreciation',  false, '630'   , 2750),
  ('BE', '630200',   'Dotations aux amortissements sur immobilisations corporelles', 'expense_depreciation',  false, '630'   , 2760),
  ('BE', '631',      'Réductions de valeur sur stocks',                             'expense_depreciation',  false, '63'    , 2770),
  ('BE', '634',      'Réductions de valeur sur créances commerciales à un an au plus', 'expense_depreciation',  false, '63'    , 2780),
  ('BE', '634000',   'Réductions de valeur sur créances commerciales',              'expense_depreciation',  false, '634'   , 2790),
  ('BE', '635',      'Provisions pour risques et charges — dotations',              'expense_depreciation',  false, '63'    , 2800),

  ('BE', '64',       'Autres charges d''exploitation',                              'expense',               false, null    , 2810),
  ('BE', '640',      'Charges fiscales d''exploitation',                            'expense',               false, '64'    , 2820),
  ('BE', '640000',   'Taxes et impôts d''exploitation',                             'expense',               false, '640'   , 2830),
  ('BE', '640100',   'Taxe de circulation et taxes sur les véhicules',              'expense',               false, '640'   , 2840),
  ('BE', '640200',   'TVA non déductible',                                          'expense',               false, '640'   , 2850),
  ('BE', '641',      'Moins-values sur réalisations courantes d''immobilisations corporelles', 'expense',               false, '64'    , 2860),
  ('BE', '643',      'Charges d''exploitation diverses',                            'expense',               false, '64'    , 2870),
  ('BE', '643000',   'Charges d''exploitation diverses',                            'expense',               false, '643'   , 2880),

  ('BE', '65',       'Charges financières',                                         'expense',               false, null    , 2890),
  ('BE', '650',      'Charges des dettes',                                          'expense',               false, '65'    , 2900),
  ('BE', '650000',   'Intérêts et charges des dettes',                              'expense',               false, '650'   , 2910),
  ('BE', '653',      'Charges d''escompte de créances',                             'expense',               false, '65'    , 2920),
  ('BE', '654',      'Différences de change',                                       'expense',               false, '65'    , 2930),
  ('BE', '654000',   'Différences de change négatives',                             'expense',               false, '654'   , 2940),
  ('BE', '656',      'Charges financières diverses',                                'expense',               false, '65'    , 2950),
  ('BE', '656000',   'Frais bancaires et de paiement',                              'expense',               false, '656'   , 2960),

  ('BE', '66',       'Charges exceptionnelles',                                     'expense',               false, null    , 2970),
  ('BE', '660',      'Amortissements et réductions de valeur exceptionnels',        'expense',               false, '66'    , 2980),
  ('BE', '663',      'Moins-values sur réalisation d''actifs immobilisés',          'expense',               false, '66'    , 2990),
  ('BE', '663000',   'Moins-values sur réalisation d''actifs immobilisés',          'expense',               false, '663'   , 3000),
  ('BE', '664',      'Autres charges exceptionnelles',                              'expense',               false, '66'    , 3010),
  ('BE', '664000',   'Charges diverses',                                            'expense',               false, '664'   , 3020),
  ('BE', '664100',   'Amendes, pénalités et intérêts de retard',                    'expense',               false, '664'   , 3030),

  ('BE', '67',       'Impôts sur le résultat',                                      'expense',               false, null    , 3040),
  ('BE', '670',      'Impôts belges sur le résultat de l''exercice',                'expense',               false, '67'    , 3050),
  ('BE', '670000',   'Impôts sur le résultat de l''exercice',                       'expense',               false, '670'   , 3060),
  ('BE', '671',      'Impôts belges sur le résultat d''exercices antérieurs',       'expense',               false, '67'    , 3070),

  ('BE', '68',       'Transferts aux réserves immunisées',                          'expense',               false, null    , 3080),

  ('BE', '69',       'Affectations et prélèvements',                                'expense',               false, null    , 3090),
  ('BE', '691',      'Dotation à la réserve légale',                                'expense',               false, '69'    , 3100),
  ('BE', '692',      'Dotation aux autres réserves',                                'expense',               false, '69'    , 3110),
  ('BE', '693',      'Bénéfice à reporter',                                         'expense',               false, '69'    , 3120),
  ('BE', '693000',   'Bénéfice à reporter',                                         'expense',               false, '693'   , 3130),
  ('BE', '694',      'Rémunération du capital',                                     'expense',               false, '69'    , 3140),
  ('BE', '694000',   'Dividendes distribués',                                       'expense',               false, '694'   , 3150),

  -- =======================================================================
  -- Classe 7 — Produits
  -- =======================================================================
  ('BE', '70',       'Chiffre d''affaires',                                         'income',                false, null    , 3160),
  ('BE', '700',      'Ventes de marchandises',                                      'income',                false, '70'    , 3170),
  ('BE', '700000',   'Ventes de marchandises ou de services',                       'income',                false, '700'   , 3180),
  ('BE', '700100',   'Ventes — Belgique',                                           'income',                false, '700'   , 3190),
  ('BE', '700200',   'Ventes — Union européenne',                                   'income',                false, '700'   , 3200),
  ('BE', '700300',   'Ventes — hors Union européenne',                              'income',                false, '700'   , 3210),
  ('BE', '701',      'Ventes de produits finis',                                    'income',                false, '70'    , 3220),
  ('BE', '704',      'Prestations de services',                                     'income',                false, '70'    , 3230),
  ('BE', '704000',   'Prestations de services',                                     'income',                false, '704'   , 3240),
  ('BE', '708',      'Remises, ristournes et rabais accordés',                      'income',                false, '70'    , 3250),
  ('BE', '708000',   'Remises, ristournes et rabais accordés',                      'income',                false, '708'   , 3260),

  ('BE', '71',       'Variation des stocks et des commandes en cours d''exécution', 'income_other',          false, null    , 3270),

  ('BE', '72',       'Production immobilisée',                                      'income_other',          false, null    , 3280),

  ('BE', '73',       'Cotisations, dons, legs et subsides',                         'income_other',          false, null    , 3290),

  ('BE', '74',       'Autres produits d''exploitation',                             'income_other',          false, null    , 3300),
  ('BE', '740',      'Autres produits d''exploitation',                             'income_other',          false, '74'    , 3310),
  ('BE', '740000',   'Autres produits d''exploitation',                             'income_other',          false, '740'   , 3320),
  ('BE', '740100',   'Subsides d''exploitation et montants compensatoires',         'income_other',          false, '740'   , 3330),
  ('BE', '740200',   'Refacturations de frais',                                     'income_other',          false, '740'   , 3340),
  ('BE', '741',      'Plus-values sur réalisations courantes d''immobilisations corporelles', 'income_other',          false, '74'    , 3350),

  ('BE', '75',       'Produits financiers',                                         'income_other',          false, null    , 3360),
  ('BE', '751',      'Produits des actifs circulants',                              'income_other',          false, '75'    , 3370),
  ('BE', '751000',   'Intérêts créditeurs',                                         'income_other',          false, '751'   , 3380),
  ('BE', '754',      'Différences de change',                                       'income_other',          false, '75'    , 3390),
  ('BE', '754000',   'Différences de change positives',                             'income_other',          false, '754'   , 3400),
  ('BE', '757',      'Escomptes obtenus',                                           'income_other',          false, '75'    , 3410),
  ('BE', '757000',   'Escomptes obtenus',                                           'income_other',          false, '757'   , 3420),

  ('BE', '76',       'Produits exceptionnels',                                      'income_other',          false, null    , 3430),
  ('BE', '763',      'Plus-values sur réalisation d''actifs immobilisés',           'income_other',          false, '76'    , 3440),
  ('BE', '763000',   'Plus-values sur réalisation d''actifs immobilisés',           'income_other',          false, '763'   , 3450),
  ('BE', '764',      'Autres produits exceptionnels',                               'income_other',          false, '76'    , 3460),
  ('BE', '764000',   'Produits divers',                                             'income_other',          false, '764'   , 3470),

  ('BE', '77',       'Régularisations d''impôts et reprises de provisions fiscales', 'income_other',          false, null    , 3480),

  ('BE', '79',       'Affectations et prélèvements',                                'income_other',          false, null    , 3490),
  ('BE', '790',      'Bénéfice reporté de l''exercice précédent',                   'income_other',          false, '79'    , 3500),
  ('BE', '792',      'Prélèvements sur les réserves',                               'income_other',          false, '79'    , 3510),
  ('BE', '793',      'Perte à reporter',                                            'income_other',          false, '79'    , 3520),
  ('BE', '793000',   'Perte à reporter',                                            'income_other',          false, '793'   , 3530)
on conflict (country, code) do nothing;

insert into journal_templates (country, code, name, journal_type, sequence) values
  ('BE', 'SAL',  'Journal des ventes',   'sales',    10),
  ('BE', 'PUR',  'Journal des achats',   'purchase', 20),
  ('BE', 'BNK',  'Journal financier',    'bank',     30),
  ('BE', 'CSH',  'Journal de caisse',    'cash',     40),
  ('BE', 'MISC', 'Opérations diverses',  'general',  50),
  ('BE', 'OPN',  'Journal d''ouverture', 'opening',  60)
on conflict (country, code) do nothing;

insert into country_defaults (country, name, currency_code, receivable_code, payable_code, suspense_code, rounding_code, retained_earnings_code, sales_account_code, purchase_account_code, bank_account_code, cash_account_code, sales_journal_code, purchase_journal_code, misc_journal_code) values
  ('BE', 'Belgium', 'EUR', '400000', '440000', '499000', '664000', '140000', '700000', '610000', '550000', '570000', 'SAL', 'PUR', 'MISC')
on conflict (country) do nothing;

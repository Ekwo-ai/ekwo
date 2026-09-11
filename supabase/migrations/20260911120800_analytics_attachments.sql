-- Ekwo OS — analytic dimensions and polymorphic attachments.

-- ---------------------------------------------------------------------------
-- Analytic axes
--
-- Axes and values in tables, joined to entry lines by a table, not a JSON
-- column and certainly not by columns created at runtime: under Supabase we
-- want joins and row level security.
-- ---------------------------------------------------------------------------

create table analytic_axes (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  code       text not null,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

comment on table analytic_axes is 'Analytic dimensions: cost centre, project, activity.';

create unique index analytic_axes_id_company_idx on analytic_axes (id, company_id);

create trigger analytic_axes_set_updated_at
  before update on analytic_axes
  for each row execute function set_updated_at();

create table analytic_values (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  axis_id    uuid not null references analytic_axes(id) on delete cascade,
  code       text not null,
  name       text not null,
  parent_id  uuid references analytic_values(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (axis_id, code),
  foreign key (axis_id, company_id) references analytic_axes(id, company_id)
);

comment on table analytic_values is 'Values of an axis, optionally hierarchical.';

create unique index analytic_values_id_company_idx on analytic_values (id, company_id);
create index analytic_values_parent_idx on analytic_values (parent_id);

create trigger analytic_values_set_updated_at
  before update on analytic_values
  for each row execute function set_updated_at();

create table entry_line_analytics (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  entry_line_id     uuid not null references entry_lines(id) on delete cascade,
  analytic_value_id uuid not null references analytic_values(id) on delete restrict,
  percentage        numeric(7, 3) not null default 100,
  amount            numeric(16, 2),
  created_at        timestamptz not null default now(),
  unique (entry_line_id, analytic_value_id),
  constraint entry_line_analytics_percentage check (percentage > 0 and percentage <= 100),
  foreign key (entry_line_id, company_id) references entry_lines(id, company_id) on delete cascade,
  foreign key (analytic_value_id, company_id) references analytic_values(id, company_id)
);

comment on table entry_line_analytics is 'Analytic split of a ledger line. One row per value, share in percent.';

create index entry_line_analytics_value_idx on entry_line_analytics (analytic_value_id);

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------

create table attachments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  -- Polymorphic: which table the file belongs to, and which row.
  entity_type  text not null,
  entity_id    uuid not null,
  file_name    text not null,
  mime_type    text,
  byte_size    bigint,
  -- Path in Supabase Storage, or any URI the application understands.
  storage_path text not null,
  checksum     text,
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  constraint attachments_entity_type check (
    entity_type in ('company', 'contact', 'document', 'entry', 'payment',
                    'bank_statement', 'bank_transaction', 'fiscal_year')
  ),
  constraint attachments_size check (byte_size is null or byte_size >= 0)
);

comment on table attachments is 'Files attached to any record. `entity_type` is constrained rather than free text.';

create index attachments_entity_idx on attachments (entity_type, entity_id);
create index attachments_company_idx on attachments (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table analytic_axes        enable row level security;
alter table analytic_values      enable row level security;
alter table entry_line_analytics enable row level security;
alter table attachments          enable row level security;

create policy analytic_axes_select on analytic_axes
  for select using (is_company_member(company_id));
create policy analytic_axes_write on analytic_axes
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy analytic_values_select on analytic_values
  for select using (is_company_member(company_id));
create policy analytic_values_write on analytic_values
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy entry_line_analytics_select on entry_line_analytics
  for select using (is_company_member(company_id));
create policy entry_line_analytics_write on entry_line_analytics
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy attachments_select on attachments
  for select using (is_company_member(company_id));
create policy attachments_write on attachments
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

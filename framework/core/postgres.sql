-- OpenPearl tenant data in Postgres, protected by row-level security.
-- Apply as a privileged role (framework/migrate.js). The runtime connects as
-- openpearl_app, which is not the table owner and cannot bypass RLS, and sets
-- openpearl.tenant / openpearl.user / openpearl.admin per transaction.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'openpearl_app') then
    create role openpearl_app login nobypassrls;
  end if;
end $$;

create table if not exists openpearl_collections (
  name text primary key,
  visibility text not null check (visibility in ('tenant', 'owner'))
);

create table if not exists openpearl_rows (
  id uuid primary key default gen_random_uuid(),
  collection text not null references openpearl_collections (name),
  tenant text not null,
  owner text not null,
  doc jsonb not null default '{}'::jsonb
);
create index if not exists openpearl_rows_scope on openpearl_rows (tenant, collection);

create table if not exists openpearl_kv (
  tenant text not null,
  ns text not null,
  owner text not null,
  key text not null,
  value jsonb,
  primary key (tenant, ns, owner, key)
);

create or replace function openpearl_tenant() returns text language sql stable as
  $$ select nullif(current_setting('openpearl.tenant', true), '') $$;
create or replace function openpearl_user() returns text language sql stable as
  $$ select nullif(current_setting('openpearl.user', true), '') $$;
create or replace function openpearl_admin() returns boolean language sql stable as
  $$ select coalesce(current_setting('openpearl.admin', true), '') = 'true' $$;

alter table openpearl_rows enable row level security;
alter table openpearl_rows force row level security;
alter table openpearl_kv enable row level security;
alter table openpearl_kv force row level security;

drop policy if exists rows_read on openpearl_rows;
create policy rows_read on openpearl_rows for select using (
  tenant = openpearl_tenant() and (
    owner = openpearl_user() or openpearl_admin()
    or exists (select 1 from openpearl_collections c where c.name = collection and c.visibility = 'tenant')
  )
);
drop policy if exists rows_insert on openpearl_rows;
create policy rows_insert on openpearl_rows for insert with check (tenant = openpearl_tenant() and owner = openpearl_user());
drop policy if exists rows_update on openpearl_rows;
create policy rows_update on openpearl_rows for update
  using (tenant = openpearl_tenant() and (owner = openpearl_user() or openpearl_admin()))
  with check (tenant = openpearl_tenant());

drop policy if exists kv_all on openpearl_kv;
create policy kv_all on openpearl_kv for all
  using (tenant = openpearl_tenant() and owner = openpearl_user())
  with check (tenant = openpearl_tenant() and owner = openpearl_user());

-- No delete for extensions; columns that scope a row can't be changed by the app
revoke all on openpearl_rows, openpearl_kv, openpearl_collections from openpearl_app;
grant select on openpearl_collections to openpearl_app;
grant select, insert on openpearl_rows to openpearl_app;
grant update (doc) on openpearl_rows to openpearl_app;
grant select, insert, update on openpearl_kv to openpearl_app;

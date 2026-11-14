-- The schemas a new Supabase project holds before anybody installs anything
-- in it, beside `auth` (the shim) and `extensions` (PostGIS), each with an
-- object of its own as on a real project. Supabase may add one; when it
-- does, it goes here, and a module whose schema it takes fails the test that
-- installs every module over this file. Read on new projects, October 2026.

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key);

create schema if not exists realtime;
create table if not exists realtime.messages (id bigint primary key);

create schema if not exists graphql;
create table if not exists graphql.introspection (id int primary key);

create schema if not exists graphql_public;
create function graphql_public.graphql() returns jsonb language sql as 'select null::jsonb';

create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key);

create schema if not exists pgsodium;
create table if not exists pgsodium.key (id uuid primary key);

create schema if not exists supabase_functions;
create table if not exists supabase_functions.hooks (id bigint primary key);

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create schema if not exists pgbouncer;
create function pgbouncer.get_auth(p_usename text) returns text language sql as 'select null::text';

create schema if not exists net;
create table if not exists net.http_request_queue (id bigint primary key);

create schema if not exists cron;
create table if not exists cron.job (jobid bigint primary key);

create schema if not exists _realtime;
create table if not exists _realtime.tenants (id uuid primary key);

create schema if not exists _analytics;
create table if not exists _analytics.sources (id bigint primary key);

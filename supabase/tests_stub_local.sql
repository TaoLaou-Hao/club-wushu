-- Simule les schémas auth/vault de Supabase pour tester en local. NE PAS exécuter sur Supabase.
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema extensions; create schema auth; create schema vault;
grant usage on schema public, auth, extensions to anon, authenticated;
create extension pgcrypto with schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table vault.secrets (name text primary key, secret text, description text);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets values (n, s, d); select gen_random_uuid() $$;

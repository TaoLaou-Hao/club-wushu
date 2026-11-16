-- =====================================================================
--  Club Wushu – Section technique : schéma Supabase (Phase 1)
--  Sécurité, gouvernance et conformité RGPD « by design »
--
--  Principes :
--   * Moindre privilège : RLS activée sur toutes les tables, aucun accès anonyme.
--   * Rôles : pending (inscrit non validé) < teacher < admin. Un rôle ne se
--     change JAMAIS par un UPDATE direct : uniquement via des fonctions
--     contrôlées. Le rôle admin ne s'obtient jamais par code.
--   * Codes d'invitation : stockés uniquement sous forme de hachage SHA-256,
--     usage limité, expiration, révocables, tentatives limitées.
--   * Coordonnées des membres (email, téléphone, contact d'urgence, n° de
--     licence) : chiffrées AES-256 (pgcrypto / OpenPGP) avec une clé stockée
--     dans Supabase Vault, dans un schéma privé non exposé par l'API.
--   * Mots de passe : gérés par Supabase Auth (hachage bcrypt), jamais ici.
--   * Journal d'audit : qui a fait quoi, sans copier de données personnelles.
--   * Minimisation : aucune donnée de santé, année de naissance seulement.
--   * Droits RGPD : export, anonymisation, purge selon durées de conservation.
--
--  À exécuter une seule fois dans Supabase > SQL Editor (projet région UE).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  execute 'revoke all on schema private from anon, authenticated';
end $$;

-- ---------------------------------------------------------------------
-- 1. Clé de chiffrement (Supabase Vault) — générée aléatoirement une fois
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'club_data_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'club_data_key',
      'Clé AES des coordonnées des membres (ne pas supprimer)');
  end if;
end $$;

create or replace function private.data_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'club_data_key';
  if k is null then
    raise exception 'Clé de chiffrement absente';
  end if;
  return k;
end $$;
revoke all on function private.data_key() from public;

create or replace function private.enc(p text)
returns bytea language sql stable security definer set search_path = '' as $$
  select case when p is null or btrim(p) = '' then null
         else extensions.pgp_sym_encrypt(p, private.data_key(), 'cipher-algo=aes256') end
$$;
create or replace function private.dec(p bytea)
returns text language sql stable security definer set search_path = '' as $$
  select case when p is null then null
         else extensions.pgp_sym_decrypt(p, private.data_key()) end
$$;
revoke all on function private.enc(text) from public;
revoke all on function private.dec(bytea) from public;

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 100),
  role        text not null default 'pending' check (role in ('pending','teacher','admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.belt_levels (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique check (char_length(name) between 1 and 60),
  rank   integer not null default 0,
  color  text check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);

create table public.techniques (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique check (char_length(name) between 1 and 100),
  category  text check (char_length(category) <= 60)
);

create table public.members (
  id             uuid primary key default gen_random_uuid(),
  first_name     text not null check (char_length(first_name) between 1 and 60),
  last_name      text not null check (char_length(last_name) between 1 and 60),
  birth_year     smallint check (birth_year between 1900 and 2100),
  active         boolean not null default true,
  left_at        date,
  anonymized_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null,
  -- Compte lié (un admin ou un enseignant peut aussi être pratiquant). Liaison par un admin uniquement.
  profile_id     uuid unique references public.profiles(id) on delete set null
);

-- Coordonnées chiffrées : schéma privé, AUCUN accès direct depuis l'API.
create table private.member_contacts (
  member_id      uuid primary key references public.members(id) on delete cascade,
  email_enc      bytea,
  phone_enc      bytea,
  emergency_enc  bytea,
  license_enc    bytea,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);

create table public.member_grades (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.members(id) on delete cascade,
  belt_level_id  uuid not null references public.belt_levels(id) on delete restrict,
  awarded_on     date not null default current_date,
  awarded_by     uuid references public.profiles(id) on delete set null,
  note           text check (char_length(note) <= 500),
  created_at     timestamptz not null default now()
);
create index on public.member_grades (member_id, awarded_on desc);

create table public.courses (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 100),
  description  text check (char_length(description) <= 1000),
  level        text check (char_length(level) <= 60),
  location     text check (char_length(location) <= 120),
  weekday      smallint not null check (weekday between 1 and 7),  -- 1 = lundi (ISO)
  start_time   time not null,
  end_time     time not null,
  start_date   date not null default current_date,
  end_date     date,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_time > start_time),
  check (end_date is null or end_date >= start_date)
);

-- Liste des personnes habilitées à enseigner chaque cours (définie par l'admin)
create table public.course_instructors (
  course_id   uuid not null references public.courses(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (course_id, profile_id)
);

-- Membres inscrits à un cours (liste d'appel par défaut)
create table public.course_members (
  course_id  uuid not null references public.courses(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  primary key (course_id, member_id)
);

create table public.sessions (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.courses(id) on delete cascade,
  date           date not null,
  start_time     time not null,
  end_time       time not null,
  instructor_id  uuid references public.profiles(id) on delete set null,
  status         text not null default 'planned' check (status in ('planned','done','cancelled')),
  summary        text check (char_length(summary) <= 2000),   -- ce qui a été fait
  notes          text check (char_length(notes) <= 2000),     -- remarques (pas de données de santé)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (course_id, date),
  check (end_time > start_time)
);
create index on public.sessions (date);

create table public.session_techniques (
  session_id    uuid not null references public.sessions(id) on delete cascade,
  technique_id  uuid not null references public.techniques(id) on delete cascade,
  primary key (session_id, technique_id)
);

create table public.attendance (
  session_id  uuid not null references public.sessions(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  present     boolean not null default true,
  marked_by   uuid references public.profiles(id) on delete set null,
  marked_at   timestamptz not null default now(),
  primary key (session_id, member_id)
);
create index on public.attendance (member_id);

-- Codes d'invitation enseignant : seul le hachage est conservé
create table public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique,
  label       text check (char_length(label) <= 100),
  role        text not null default 'teacher' check (role = 'teacher'),  -- jamais admin
  max_uses    integer not null default 1 check (max_uses between 1 and 20),
  uses        integer not null default 0,
  expires_at  timestamptz not null,
  revoked     boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table private.invite_attempts (
  user_id  uuid not null,
  at       timestamptz not null default now(),
  success  boolean not null
);
create index on private.invite_attempts (user_id, at);

-- Journal d'audit : identifiants et noms de colonnes uniquement, jamais les valeurs
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  action      text not null,
  table_name  text,
  record_id   text,
  details     jsonb
);
create index on public.audit_log (at desc);

-- ---------------------------------------------------------------------
-- 3. Fonctions d'autorisation
-- ---------------------------------------------------------------------
create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anonymous')
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher','admin'))
$$;

-- L'utilisateur peut-il gérer cette séance ? (admin, ou enseignant habilité sur le cours)
create or replace function public.can_manage_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.sessions s
    join public.course_instructors ci on ci.course_id = s.course_id
    join public.profiles p on p.id = ci.profile_id and p.role in ('teacher','admin')
    where s.id = p_session_id and ci.profile_id = auth.uid())
$$;

create or replace function public.can_manage_course(p_course_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.course_instructors ci
    join public.profiles p on p.id = ci.profile_id and p.role in ('teacher','admin')
    where ci.course_id = p_course_id and ci.profile_id = auth.uid())
$$;

-- L'appelant a-t-il un lien pédagogique avec ce membre ?
-- (admin, enseignant d'un cours où il est inscrit ou pointé, ou créateur de la fiche)
create or replace function public.can_access_member(p_member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (public.is_staff() and (
    exists (select 1 from public.course_members cm
            join public.course_instructors ci on ci.course_id = cm.course_id
            where cm.member_id = p_member_id and ci.profile_id = auth.uid())
    or exists (select 1 from public.attendance a
               join public.sessions s on s.id = a.session_id
               join public.course_instructors ci on ci.course_id = s.course_id
               where a.member_id = p_member_id and ci.profile_id = auth.uid())
    or exists (select 1 from public.members m where m.id = p_member_id
               and (m.created_by = auth.uid() or m.profile_id = auth.uid()))))
$$;

create or replace function private.log(p_action text, p_table text, p_record text, p_details jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, action, table_name, record_id, details)
  values (auth.uid(), p_action, p_table, p_record, p_details)
$$;
revoke all on function private.log(text, text, text, jsonb) from public;

-- ---------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------
-- Création automatique du profil (rôle "pending") à l'inscription
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name',
                                new.raw_user_meta_data->>'name', ''), 100));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Interdit toute modification directe du rôle via l'API
-- SECURITY INVOKER volontaire : current_user doit refléter l'appelant réel
create or replace function private.guard_profile()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id then raise exception 'Modification interdite'; end if;
  if new.role is distinct from old.role and current_user in ('authenticated','anon') then
    raise exception 'Le rôle ne peut être modifié que par un administrateur via la page Administration';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_profile before update on public.profiles
  for each row execute function private.guard_profile();

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch before update on public.members for each row execute function private.touch_updated_at();
create trigger touch before update on public.courses for each row execute function private.touch_updated_at();

-- Membres : traçabilité de la création, date de départ
-- SECURITY INVOKER volontaire : current_user doit refléter l'appelant réel
create or replace function private.members_defaults()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.anonymized_at := null;
    if not new.active then new.left_at := current_date; else new.left_at := null; end if;
    if current_user in ('authenticated','anon') and not public.is_admin() then new.profile_id := null; end if;
  else
    if current_user in ('authenticated','anon') and not public.is_admin() then new.profile_id := old.profile_id; end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if current_user in ('authenticated','anon') then
      -- Une fiche anonymisée est définitive (droit à l'effacement)
      if old.anonymized_at is not null then
        raise exception 'Fiche anonymisée : modification impossible';
      end if;
      new.anonymized_at := old.anonymized_at;
      -- La date de départ n'est pas modifiable à la main (évite une purge anticipée)
      new.left_at := old.left_at;
    end if;
    if old.active and not new.active then new.left_at := current_date; end if;
    if new.active then new.left_at := null; end if;
  end if;
  return new;
end $$;
create trigger members_defaults before insert or update on public.members
  for each row execute function private.members_defaults();

-- SECURITY INVOKER volontaire : current_user doit refléter l'appelant réel
create or replace function private.grades_defaults()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.awarded_by := auth.uid(); new.created_at := now();
  else new.awarded_by := old.awarded_by; new.member_id := old.member_id; new.created_at := old.created_at; end if;
  if new.awarded_on > current_date then raise exception 'La date du grade ne peut pas être dans le futur'; end if;
  return new;
end $$;
create trigger grades_defaults before insert or update on public.member_grades
  for each row execute function private.grades_defaults();

-- SECURITY INVOKER volontaire : current_user doit refléter l'appelant réel
create or replace function private.attendance_defaults()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.marked_by := auth.uid();
  new.marked_at := now();
  return new;
end $$;
create trigger attendance_defaults before insert or update on public.attendance
  for each row execute function private.attendance_defaults();

-- Séances : un enseignant ne peut pas déplacer une séance ; l'intervenant doit être habilité
-- SECURITY INVOKER volontaire : current_user doit refléter l'appelant réel
create or replace function private.guard_session()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_user in ('authenticated','anon') and not public.is_admin() then
    if new.course_id <> old.course_id or new.date <> old.date
       or new.start_time <> old.start_time or new.end_time <> old.end_time then
      raise exception 'Seul un administrateur peut modifier la date ou l''horaire d''une séance';
    end if;
  end if;
  if new.instructor_id is not null and not exists (
       select 1 from public.course_instructors
       where course_id = new.course_id and profile_id = new.instructor_id) then
    raise exception 'Cet intervenant n''est pas habilité à enseigner ce cours';
  end if;
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_session before insert or update on public.sessions
  for each row execute function private.guard_session();

-- Codes d'invitation : via l'API, seule la révocation est possible
create or replace function private.guard_invite()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') then
    if (to_jsonb(new) - 'revoked') <> (to_jsonb(old) - 'revoked') or (old.revoked and not new.revoked) then
      raise exception 'Seule la révocation d''un code est autorisée';
    end if;
  end if;
  return new;
end $$;
create trigger guard_invite before update on public.invite_codes
  for each row execute function private.guard_invite();

-- Journal d'audit générique (arguments = colonnes clés)
create or replace function private.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; o jsonb; rid text := ''; k text; i int; changed jsonb;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  for i in 0 .. tg_nargs - 1 loop
    k := tg_argv[i];
    rid := rid || case when i > 0 then '/' else '' end || coalesce(r->>k, '');
  end loop;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    select coalesce(jsonb_agg(key), '[]'::jsonb) into changed
    from jsonb_each(r) e(key, value)
    where e.value is distinct from o->e.key and e.key not in ('updated_at','marked_at');
    if changed = '[]'::jsonb then return null; end if;
    perform private.log(lower(tg_op), tg_table_name, rid, jsonb_build_object('colonnes', changed));
  else
    perform private.log(lower(tg_op), tg_table_name, rid, null);
  end if;
  return null;
end $$;

create trigger audit after insert or update or delete on public.profiles           for each row execute function private.audit_trigger('id');
create trigger audit after insert or update or delete on public.members            for each row execute function private.audit_trigger('id');
create trigger audit after insert or update or delete on public.member_grades      for each row execute function private.audit_trigger('id');
create trigger audit after insert or update or delete on public.courses            for each row execute function private.audit_trigger('id');
create trigger audit after insert or update or delete on public.course_instructors for each row execute function private.audit_trigger('course_id','profile_id');
create trigger audit after insert or update or delete on public.course_members     for each row execute function private.audit_trigger('course_id','member_id');
create trigger audit after insert or update or delete on public.sessions           for each row execute function private.audit_trigger('id');
create trigger audit after insert or update or delete on public.attendance         for each row execute function private.audit_trigger('session_id','member_id');
create trigger audit after insert or update or delete on public.invite_codes       for each row execute function private.audit_trigger('id');
create trigger audit after insert or update or delete on public.belt_levels        for each row execute function private.audit_trigger('id');
create trigger audit after insert or update or delete on public.techniques         for each row execute function private.audit_trigger('id');
create trigger audit after insert or update or delete on public.session_techniques for each row execute function private.audit_trigger('session_id','technique_id');

-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.belt_levels        enable row level security;
alter table public.techniques         enable row level security;
alter table public.members            enable row level security;
alter table public.member_grades      enable row level security;
alter table public.courses            enable row level security;
alter table public.course_instructors enable row level security;
alter table public.course_members     enable row level security;
alter table public.sessions           enable row level security;
alter table public.session_techniques enable row level security;
alter table public.attendance         enable row level security;
alter table public.invite_codes       enable row level security;
alter table public.audit_log          enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or (public.is_staff() and role <> 'pending'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- référentiels (lecture équipe, écriture admin)
create policy belts_select on public.belt_levels for select to authenticated using (public.is_staff());
create policy belts_write  on public.belt_levels for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tech_select  on public.techniques  for select to authenticated using (public.is_staff());
create policy tech_insert  on public.techniques  for insert to authenticated with check (public.is_staff());
create policy tech_modify  on public.techniques  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tech_delete  on public.techniques  for delete to authenticated using (public.is_admin());

-- membres
create policy members_select on public.members for select to authenticated using (public.is_staff());
create policy members_insert on public.members for insert to authenticated with check (public.is_staff());
create policy members_update on public.members for update to authenticated
  using (public.can_access_member(id)) with check (public.can_access_member(id));
create policy members_delete on public.members for delete to authenticated using (public.is_admin());

-- grades
create policy grades_select on public.member_grades for select to authenticated using (public.is_staff());
-- Un enseignant ne peut pas se décerner un grade à lui-même (seul un admin le peut)
create policy grades_insert on public.member_grades for insert to authenticated
  with check (public.can_access_member(member_id) and (public.is_admin() or not exists (
    select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())));
create policy grades_update on public.member_grades for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy grades_delete on public.member_grades for delete to authenticated using (public.is_admin());

-- cours
create policy courses_select on public.courses for select to authenticated using (public.is_staff());
create policy courses_write  on public.courses for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ci_select on public.course_instructors for select to authenticated using (public.is_staff());
create policy ci_write  on public.course_instructors for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cm_select on public.course_members for select to authenticated using (public.is_staff());
create policy cm_write  on public.course_members for all    to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

-- séances
create policy sessions_select on public.sessions for select to authenticated using (public.is_staff());
create policy sessions_insert on public.sessions for insert to authenticated with check (public.is_admin());
create policy sessions_update on public.sessions for update to authenticated
  using (public.can_manage_session(id)) with check (public.can_manage_course(course_id));
create policy sessions_delete on public.sessions for delete to authenticated using (public.is_admin());

create policy st_select on public.session_techniques for select to authenticated using (public.is_staff());
create policy st_write  on public.session_techniques for all    to authenticated
  using (public.can_manage_session(session_id)) with check (public.can_manage_session(session_id));

create policy att_select on public.attendance for select to authenticated using (public.is_staff());
create policy att_write  on public.attendance for all    to authenticated
  using (public.can_manage_session(session_id)) with check (public.can_manage_session(session_id));

-- invitations et audit : admin uniquement (lecture / révocation)
create policy inv_select on public.invite_codes for select to authenticated using (public.is_admin());
create policy inv_update on public.invite_codes for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. Fonctions métier (RPC)
-- ---------------------------------------------------------------------

-- Liste des comptes (admin) : email depuis auth.users, non exposé ailleurs
create or replace function public.list_users()
returns table (id uuid, email text, full_name text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.created_at, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.id
    order by p.created_at;
end $$;

-- Changement de rôle (admin). Impossible de retirer le dernier admin.
create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_role text;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  if p_role not in ('pending','teacher','admin') then raise exception 'Rôle invalide'; end if;
  perform pg_advisory_xact_lock(hashtext('club_admin_roles'));
  select role into old_role from public.profiles where id = p_user_id for update;
  if old_role is null then raise exception 'Utilisateur introuvable'; end if;
  if old_role = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Impossible de retirer le dernier administrateur';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if p_role = 'pending' then
    delete from public.course_instructors where profile_id = p_user_id;
  end if;
  perform private.log('role_change', 'profiles', p_user_id::text,
                      jsonb_build_object('ancien', old_role, 'nouveau', p_role));
end $$;

-- Suppression d'un compte (admin) — droit à l'effacement des utilisateurs
create or replace function public.delete_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  if p_user_id = auth.uid() then raise exception 'Vous ne pouvez pas supprimer votre propre compte ici'; end if;
  perform pg_advisory_xact_lock(hashtext('club_admin_roles'));
  if (select role from public.profiles where id = p_user_id) = 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Impossible de supprimer le dernier administrateur';
  end if;
  delete from auth.users where id = p_user_id;
  perform private.log('user_delete', 'profiles', p_user_id::text);
end $$;

-- Création d'un code enseignant : renvoyé UNE seule fois en clair, stocké haché
create or replace function public.create_invite_code(p_label text default null, p_days integer default 7, p_max_uses integer default 1)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  if p_days not between 1 and 30 then raise exception 'Durée de validité : 1 à 30 jours'; end if;
  if p_max_uses not between 1 and 20 then raise exception 'Nombre d''utilisations : 1 à 20'; end if;
  -- 80 bits d'entropie, alphabet sans caractères ambigus
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
    into v_code
    from (select extensions.gen_random_bytes(16) as b) x, generate_series(0, 15) i;
  v_code := 'WS-' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
  insert into public.invite_codes (code_hash, label, max_uses, expires_at, created_by)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), left(p_label, 100), p_max_uses,
          now() + make_interval(days => p_days), auth.uid());
  return v_code;
end $$;

-- Utilisation d'un code par un compte "pending" (5 essais max par heure)
create or replace function public.redeem_invite_code(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_hash text; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if (select role from public.profiles where id = v_uid) <> 'pending' then
    raise exception 'Votre compte a déjà un rôle';
  end if;
  if (select count(*) from private.invite_attempts
      where user_id = v_uid and not success and at > now() - interval '1 hour') >= 5 then
    raise exception 'Trop de tentatives. Réessayez dans une heure.';
  end if;
  v_hash := encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex');
  select id into v_id from public.invite_codes
   where code_hash = v_hash and not revoked and expires_at > now() and uses < max_uses
   for update;
  if v_id is null then
    insert into private.invite_attempts (user_id, success) values (v_uid, false);
    perform private.log('invite_failed', 'invite_codes', null);
    return 'invalid';
  end if;
  update public.invite_codes set uses = uses + 1 where id = v_id;
  update public.profiles set role = 'teacher' where id = v_uid;
  insert into private.invite_attempts (user_id, success) values (v_uid, true);
  perform private.log('invite_redeemed', 'invite_codes', v_id::text);
  return 'ok';
end $$;

-- Coordonnées chiffrées : écriture
create or replace function public.set_member_contact(p_member_id uuid, p_email text, p_phone text, p_emergency text, p_license text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_access_member(p_member_id) then raise exception 'Accès refusé : ce membre ne suit aucun de vos cours'; end if;
  if not public.is_admin() and exists (select 1 from private.member_contacts where member_id = p_member_id)
     and coalesce(btrim(p_email),'') || coalesce(btrim(p_phone),'') || coalesce(btrim(p_emergency),'') || coalesce(btrim(p_license),'') = '' then
    raise exception 'Seul un administrateur peut effacer toutes les coordonnées';
  end if;
  if not exists (select 1 from public.members where id = p_member_id and anonymized_at is null) then
    raise exception 'Membre introuvable';
  end if;
  if coalesce(char_length(p_email), 0) > 254 or coalesce(char_length(p_phone), 0) > 30
     or coalesce(char_length(p_emergency), 0) > 200 or coalesce(char_length(p_license), 0) > 40 then
    raise exception 'Valeur trop longue';
  end if;
  insert into private.member_contacts as c (member_id, email_enc, phone_enc, emergency_enc, license_enc, updated_by)
  values (p_member_id, private.enc(p_email), private.enc(p_phone), private.enc(p_emergency), private.enc(p_license), auth.uid())
  on conflict (member_id) do update
    set email_enc = excluded.email_enc, phone_enc = excluded.phone_enc,
        emergency_enc = excluded.emergency_enc, license_enc = excluded.license_enc,
        updated_at = now(), updated_by = auth.uid();
  perform private.log('contact_update', 'member_contacts', p_member_id::text);
end $$;

-- Coordonnées chiffrées : lecture (chaque consultation est journalisée)
create or replace function public.get_member_contact(p_member_id uuid)
returns table (email text, phone text, emergency text, license text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_access_member(p_member_id) then raise exception 'Accès refusé : ce membre ne suit aucun de vos cours'; end if;
  if (select count(*) from public.audit_log
      where actor = auth.uid() and action = 'contact_read' and at > now() - interval '1 hour') >= 40 then
    raise exception 'Trop de consultations de coordonnées. Réessayez plus tard.';
  end if;
  perform private.log('contact_read', 'member_contacts', p_member_id::text);
  return query
    select private.dec(c.email_enc), private.dec(c.phone_enc),
           private.dec(c.emergency_enc), private.dec(c.license_enc)
    from private.member_contacts c where c.member_id = p_member_id;
end $$;

-- Génération des séances à partir des horaires fixes des cours
create or replace function public.generate_sessions(p_from date, p_to date)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  if p_to < p_from or p_to - p_from > 366 then raise exception 'Période invalide (366 jours max)'; end if;
  insert into public.sessions (course_id, date, start_time, end_time)
  select c.id, d::date, c.start_time, c.end_time
  from public.courses c
  cross join generate_series(greatest(p_from, c.start_date), least(p_to, coalesce(c.end_date, p_to)), interval '1 day') d
  where c.active and extract(isodow from d) = c.weekday
  on conflict (course_id, date) do nothing;
  get diagnostics n = row_count;
  perform private.log('generate_sessions', 'sessions', null,
                      jsonb_build_object('du', p_from, 'au', p_to, 'crees', n));
  return n;
end $$;

-- Après modification d'un horaire : réaligne les séances futures non commencées
create or replace function public.resync_course_sessions(p_course_id uuid, p_weeks integer default 12)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; c record;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  if p_weeks not between 1 and 52 then raise exception 'Nombre de semaines : 1 à 52'; end if;
  select * into c from public.courses where id = p_course_id;
  if c.id is null then raise exception 'Cours introuvable'; end if;
  -- Supprime les séances futures prévues sans présence ni compte rendu
  delete from public.sessions s
   where s.course_id = p_course_id and s.date >= current_date and s.status = 'planned'
     and coalesce(btrim(s.summary), '') = '' and coalesce(btrim(s.notes), '') = ''
     and s.instructor_id is null
     and not exists (select 1 from public.attendance a where a.session_id = s.id)
     and not exists (select 1 from public.session_techniques t where t.session_id = s.id);
  if not c.active then return 0; end if;
  insert into public.sessions (course_id, date, start_time, end_time)
  select c.id, d::date, c.start_time, c.end_time
  from generate_series(greatest(current_date, c.start_date),
                       least(current_date + p_weeks * 7, coalesce(c.end_date, current_date + p_weeks * 7)),
                       interval '1 day') d
  where extract(isodow from d) = c.weekday
  on conflict (course_id, date) do nothing;
  get diagnostics n = row_count;
  perform private.log('resync_sessions', 'courses', p_course_id::text, jsonb_build_object('crees', n));
  return n;
end $$;

-- RGPD : export des données d'un membre (droit d'accès / portabilité)
create or replace function public.export_member_data(p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  select jsonb_build_object(
    'membre', to_jsonb(m) - 'created_by',
    'coordonnees', (select jsonb_build_object('email', private.dec(email_enc), 'telephone', private.dec(phone_enc),
                      'contact_urgence', private.dec(emergency_enc), 'licence', private.dec(license_enc))
                    from private.member_contacts where member_id = m.id),
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('grade', b.name, 'date', g.awarded_on, 'note', g.note) order by g.awarded_on), '[]')
               from public.member_grades g join public.belt_levels b on b.id = g.belt_level_id where g.member_id = m.id),
    'presences', (select coalesce(jsonb_agg(jsonb_build_object('date', s.date, 'cours', c.name, 'present', a.present) order by s.date), '[]')
                  from public.attendance a join public.sessions s on s.id = a.session_id
                  join public.courses c on c.id = s.course_id where a.member_id = m.id),
    'cours_inscrits', (select coalesce(jsonb_agg(c.name order by c.name), '[]')
                       from public.course_members cm join public.courses c on c.id = cm.course_id where cm.member_id = m.id),
    'consultations_coordonnees', (select coalesce(jsonb_agg(jsonb_build_object('date', l.at, 'par', p.full_name) order by l.at), '[]')
                                  from public.audit_log l left join public.profiles p on p.id = l.actor
                                  where l.action = 'contact_read' and l.record_id = m.id::text),
    'exporte_le', now())
  into res from public.members m where m.id = p_member_id;
  if res is null then raise exception 'Membre introuvable'; end if;
  perform private.log('member_export', 'members', p_member_id::text);
  return res;
end $$;

-- RGPD : anonymisation (droit à l'effacement) — conserve les statistiques
create or replace function public.anonymize_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  update public.members
     set first_name = 'Anonyme', last_name = upper(substr(md5(id::text), 1, 6)),
         birth_year = null, active = false, left_at = coalesce(left_at, current_date),
         anonymized_at = now(), profile_id = null
   where id = p_member_id;
  if not found then raise exception 'Membre introuvable'; end if;
  delete from private.member_contacts where member_id = p_member_id;
  update public.member_grades set note = null where member_id = p_member_id;
  delete from public.course_members where member_id = p_member_id;
  perform private.log('member_anonymize', 'members', p_member_id::text);
end $$;

-- RGPD : purge selon les durées de conservation
--   * membres partis depuis plus de p_member_years ans -> anonymisés
--   * journal d'audit de plus de p_audit_days jours -> supprimé
--   * tentatives de code de plus de 30 jours -> supprimées
create or replace function public.apply_retention(p_member_years integer default 3, p_audit_days integer default 365)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_members integer := 0; v_audit integer; r record;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  if p_member_years < 1 or p_audit_days < 90 then raise exception 'Durées trop courtes'; end if;
  for r in select id from public.members
           where anonymized_at is null
             and created_at < now() - make_interval(years => p_member_years)
             and ((not active and coalesce(left_at, updated_at::date) < current_date - make_interval(years => p_member_years))
               or not exists (select 1 from public.attendance a join public.sessions s on s.id = a.session_id
                              where a.member_id = members.id and a.present
                                and s.date >= current_date - make_interval(years => p_member_years)))
  loop
    perform public.anonymize_member(r.id);
    v_members := v_members + 1;
  end loop;
  delete from public.audit_log where at < now() - make_interval(days => p_audit_days);
  get diagnostics v_audit = row_count;
  delete from private.invite_attempts where at < now() - interval '30 days';
  delete from public.invite_codes where (expires_at < now() - interval '30 days') or (revoked and created_at < now() - interval '30 days');  -- codes révoqués : 30 jours après leur création
  perform private.log('retention', null, null, jsonb_build_object('membres_anonymises', v_members, 'logs_supprimes', v_audit));
  return jsonb_build_object('membres_anonymises', v_members, 'logs_supprimes', v_audit);
end $$;

-- Maintien en activité du projet gratuit (appelé par GitHub Actions avec la clé publique)
create or replace function public.keepalive()
returns integer language sql security definer set search_path = '' as $$
  select 1 + (select count(*) from public.belt_levels)::integer * 0
$$;

-- ---------------------------------------------------------------------
-- 7. Privilèges (défense en profondeur : rien pour anon, sauf keepalive)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public  from anon;
revoke all on all sequences in schema public  from anon;
revoke all on all functions in schema public  from public, anon;
revoke all on all tables    in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, delete on public.invite_codes from authenticated;
revoke insert, delete on public.profiles from authenticated;

revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Les objets créés plus tard ne seront pas ouverts automatiquement à l'API
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

grant execute on function public.keepalive() to anon, authenticated;
grant execute on function
  public.current_role_name(), public.is_admin(), public.is_staff(),
  public.can_manage_session(uuid), public.can_manage_course(uuid), public.can_access_member(uuid),
  public.list_users(), public.set_user_role(uuid, text), public.delete_user(uuid),
  public.create_invite_code(text, integer, integer), public.redeem_invite_code(text),
  public.set_member_contact(uuid, text, text, text, text), public.get_member_contact(uuid),
  public.generate_sessions(date, date), public.resync_course_sessions(uuid, integer),
  public.export_member_data(uuid), public.anonymize_member(uuid),
  public.apply_retention(integer, integer)
to authenticated;

-- ---------------------------------------------------------------------
-- 8. Données de départ (modifiables dans l'appli)
-- ---------------------------------------------------------------------
insert into public.belt_levels (name, rank, color) values
  ('Blanche', 1, '#f5f5f5'), ('Jaune', 2, '#f2c200'), ('Orange', 3, '#f28c00'),
  ('Verte', 4, '#2e9e44'), ('Bleue', 5, '#2463c7'), ('Marron', 6, '#7a4a21'),
  ('Noire', 7, '#111111')
on conflict (name) do nothing;

insert into public.techniques (name, category) values
  ('Échauffement', 'Préparation'), ('Assouplissements', 'Préparation'),
  ('Jibengong (techniques de base)', 'Bases'), ('Positions (Bu Xing)', 'Bases'),
  ('Coups de pied', 'Bases'), ('Taolu main nue', 'Taolu'), ('Taolu armes', 'Taolu'),
  ('Sauts et acrobaties', 'Technique'), ('Renforcement musculaire', 'Physique')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- 9. Premier administrateur — après votre première connexion à l'appli,
--    exécutez (en remplaçant l'email) :
--
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'votre.email@exemple.fr');
-- =====================================================================

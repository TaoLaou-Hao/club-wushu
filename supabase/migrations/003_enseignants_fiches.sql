-- Migration 003 : les enseignants sont des FICHES MEMBRES (avec ou sans compte).
--  * members.is_instructor : fiche habilitée à enseigner (défini par un admin)
--  * course_instructors(course_id, member_id) : enseignants habilités par cours
--  * sessions.instructor_id -> members(id)
--  * Droits dans l'appli : un compte enseignant agit sur un cours si SA fiche liée
--    (members.profile_id) figure parmi les enseignants habilités du cours.
-- Idempotente : peut être rejouée. À exécuter après schema.sql et 002.

alter table public.members add column if not exists is_instructor boolean not null default false;

-- 1. Fiches pour les comptes déjà habilités qui n'en ont pas encore
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'course_instructors' and column_name = 'profile_id') then
    insert into public.members (first_name, last_name, profile_id, is_instructor)
    select left(coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), 'Prénom'), 60),
           left(coalesce(nullif(btrim(substr(btrim(p.full_name), length(split_part(btrim(p.full_name), ' ', 1)) + 1)), ''), 'Nom'), 60),
           p.id, true
    from public.profiles p
    where exists (select 1 from public.course_instructors ci where ci.profile_id = p.id)
       or exists (select 1 from public.sessions s where s.instructor_id = p.id)
    on conflict (profile_id) do nothing;

    -- 2. course_instructors : profile_id -> member_id
    alter table public.course_instructors add column if not exists member_id uuid references public.members(id) on delete cascade;
    update public.course_instructors ci set member_id = m.id from public.members m where m.profile_id = ci.profile_id;
    update public.members set is_instructor = true where id in (select member_id from public.course_instructors);
    drop trigger if exists audit on public.course_instructors;
    alter table public.course_instructors drop constraint if exists course_instructors_pkey;
    alter table public.course_instructors drop column profile_id;
    alter table public.course_instructors alter column member_id set not null;
    alter table public.course_instructors add primary key (course_id, member_id);

    -- 3. sessions.instructor_id : profil -> fiche membre
    alter table public.sessions drop constraint if exists sessions_instructor_id_fkey;
    alter table public.sessions disable trigger guard_session;
    update public.sessions s set instructor_id = (select m.id from public.members m where m.profile_id = s.instructor_id)
     where s.instructor_id is not null;
    alter table public.sessions enable trigger guard_session;
    alter table public.sessions add constraint sessions_instructor_id_fkey
      foreign key (instructor_id) references public.members(id) on delete set null;
  end if;
end $$;

drop trigger if exists audit on public.course_instructors;
create trigger audit after insert or update or delete on public.course_instructors
  for each row execute function private.audit_trigger('course_id','member_id');

-- 4. Fonctions d'autorisation
create or replace function public.my_member_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.members where profile_id = auth.uid() and anonymized_at is null
$$;

create or replace function public.can_manage_course(p_course_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (public.is_staff() and exists (
    select 1 from public.course_instructors ci
    join public.members m on m.id = ci.member_id
    where ci.course_id = p_course_id and m.profile_id = auth.uid()))
$$;

create or replace function public.can_manage_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (public.is_staff() and exists (
    select 1 from public.sessions s
    join public.course_instructors ci on ci.course_id = s.course_id
    join public.members m on m.id = ci.member_id
    where s.id = p_session_id and m.profile_id = auth.uid()))
$$;

create or replace function public.can_access_member(p_member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (public.is_staff() and (
    exists (select 1 from public.course_members cm
            join public.course_instructors ci on ci.course_id = cm.course_id
            join public.members im on im.id = ci.member_id
            where cm.member_id = p_member_id and im.profile_id = auth.uid())
    or exists (select 1 from public.attendance a
               join public.sessions s on s.id = a.session_id
               join public.course_instructors ci on ci.course_id = s.course_id
               join public.members im on im.id = ci.member_id
               where a.member_id = p_member_id and im.profile_id = auth.uid())
    or exists (select 1 from public.members m where m.id = p_member_id
               and (m.created_by = auth.uid() or m.profile_id = auth.uid()))))
$$;

-- 5. Garde-fous
create or replace function private.members_defaults()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare api_non_admin boolean := current_user in ('authenticated','anon') and not public.is_admin();
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.anonymized_at := null;
    if not new.active then new.left_at := current_date; else new.left_at := null; end if;
    if api_non_admin then new.profile_id := null; new.is_instructor := false; end if;
  else
    if api_non_admin then new.profile_id := old.profile_id; new.is_instructor := old.is_instructor; end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if current_user in ('authenticated','anon') then
      if old.anonymized_at is not null then
        raise exception 'Fiche anonymisée : modification impossible';
      end if;
      new.anonymized_at := old.anonymized_at;
      new.left_at := old.left_at;
    end if;
    if old.active and not new.active then new.left_at := current_date; end if;
    if new.active then new.left_at := null; end if;
  end if;
  return new;
end $$;

create or replace function private.guard_session()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_user in ('authenticated','anon') and not public.is_admin() then
    if new.course_id <> old.course_id or new.date <> old.date
       or new.start_time <> old.start_time or new.end_time <> old.end_time then
      raise exception 'Seul un administrateur peut modifier la date ou l''horaire d''une séance';
    end if;
  end if;
  if new.instructor_id is not null
     and (tg_op = 'INSERT' or new.instructor_id is distinct from old.instructor_id or new.course_id <> old.course_id)
     and not exists (
       select 1 from public.course_instructors
       where course_id = new.course_id and member_id = new.instructor_id) then
    raise exception 'Cet intervenant n''est pas habilité à enseigner ce cours';
  end if;
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;

-- Seules des fiches enseignantes actives peuvent être habilitées sur un cours
drop policy if exists ci_write on public.course_instructors;
-- Retirer une habilitation libère les séances futures prévues de cet enseignant sur ce cours
create or replace function private.ci_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.sessions set instructor_id = null
   where course_id = old.course_id and instructor_id = old.member_id
     and status = 'planned' and date >= current_date;
  return old;
end $$;
drop trigger if exists ci_cleanup on public.course_instructors;
create trigger ci_cleanup after delete on public.course_instructors
  for each row execute function private.ci_cleanup();
revoke all on function private.ci_cleanup() from public, anon, authenticated;

create policy ci_write on public.course_instructors for all to authenticated
  using (public.is_admin())
  with check (public.is_admin() and exists (
    select 1 from public.members m where m.id = member_id and m.is_instructor and m.anonymized_at is null));

-- Retirer le statut enseignant retire les habilitations
create or replace function private.instructor_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_instructor and not new.is_instructor then
    delete from public.course_instructors where member_id = new.id;
    update public.sessions set instructor_id = null
     where instructor_id = new.id and status = 'planned' and date >= current_date;
  end if;
  return new;
end $$;
drop trigger if exists instructor_cleanup on public.members;
create trigger instructor_cleanup after update of is_instructor on public.members
  for each row execute function private.instructor_cleanup();

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
  perform private.log('role_change', 'profiles', p_user_id::text,
                      jsonb_build_object('ancien', old_role, 'nouveau', p_role));
end $$;

create or replace function public.anonymize_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  update public.members
     set first_name = 'Anonyme', last_name = upper(substr(md5(id::text), 1, 6)),
         birth_year = null, active = false, left_at = coalesce(left_at, current_date),
         anonymized_at = now(), profile_id = null, is_instructor = false
   where id = p_member_id;
  if not found then raise exception 'Membre introuvable'; end if;
  delete from private.member_contacts where member_id = p_member_id;
  update public.member_grades set note = null where member_id = p_member_id;
  delete from public.course_members where member_id = p_member_id;
  delete from public.course_instructors where member_id = p_member_id;
  perform private.log('member_anonymize', 'members', p_member_id::text);
end $$;

revoke all on function public.my_member_id() from public, anon;
grant execute on function public.my_member_id() to authenticated;
revoke all on function private.instructor_cleanup() from public, anon, authenticated;

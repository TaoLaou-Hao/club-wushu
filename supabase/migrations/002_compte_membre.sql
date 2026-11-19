-- Migration 002 : lier un compte (admin / enseignant) à une fiche membre
-- À exécuter une fois dans Supabase > SQL Editor (déjà inclus dans schema.sql pour une nouvelle installation).
alter table public.members add column if not exists profile_id uuid unique references public.profiles(id) on delete set null;

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

drop policy if exists grades_insert on public.member_grades;
create policy grades_insert on public.member_grades for insert to authenticated
  with check (public.can_access_member(member_id) and (public.is_admin() or not exists (
    select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())));

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

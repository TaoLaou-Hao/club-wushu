-- Migration 004 : espace membre (phase 2), codes d'activation, réponses aux séances.
--  * Rôle « member » : un pratiquant connecté. Il n'a AUCUN accès direct aux tables
--    (les politiques RLS existantes exigent is_staff()). Tout passe par des fonctions
--    qui ne renvoient que SES données : member_space(), export_my_data(),
--    get_my_contact(), set_my_contact(), set_my_rsvp().
--  * Codes d'invitation : rôle « teacher » ou « member » (jamais admin) ; un code
--    peut être rattaché à une fiche précise (code d'activation) : à l'utilisation,
--    le compte est lié automatiquement à cette fiche.
--  * session_rsvp : un membre prévient de sa présence / absence à une séance à venir.
-- Idempotente. À exécuter après schema.sql, 002 et 003.

-- 1. Rôle membre ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending','member','teacher','admin'));

create or replace function public.is_active_account()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('member','teacher','admin'))
$$;

create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_role text;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  if p_role not in ('pending','member','teacher','admin') then raise exception 'Rôle invalide'; end if;
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

-- 2. Codes d'invitation / d'activation -----------------------------------------
alter table public.invite_codes drop constraint if exists invite_codes_role_check;
alter table public.invite_codes add constraint invite_codes_role_check check (role in ('teacher','member'));
alter table public.invite_codes add column if not exists member_id uuid references public.members(id) on delete cascade;

drop function if exists public.create_invite_code(text, integer, integer);
create or replace function public.create_invite_code(p_label text default null, p_days integer default 7,
  p_max_uses integer default 1, p_role text default 'teacher', p_member_id uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  if p_role not in ('teacher','member') then raise exception 'Rôle invalide (enseignant ou membre uniquement)'; end if;
  if p_days not between 1 and 30 then raise exception 'Durée de validité : 1 à 30 jours'; end if;
  if p_max_uses not between 1 and 20 then raise exception 'Nombre d''utilisations : 1 à 20'; end if;
  if p_member_id is not null then
    if not exists (select 1 from public.members where id = p_member_id and anonymized_at is null and profile_id is null) then
      raise exception 'Fiche introuvable ou déjà liée à un compte';
    end if;
    p_max_uses := 1;
    -- un seul code d'activation valide par fiche
    update public.invite_codes set revoked = true where member_id = p_member_id and not revoked;
  end if;
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
    into v_code
    from (select extensions.gen_random_bytes(16) as b) x, generate_series(0, 15) i;
  v_code := 'WS-' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
  insert into public.invite_codes (code_hash, label, role, max_uses, expires_at, created_by, member_id)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), left(p_label, 100), p_role, p_max_uses,
          now() + make_interval(days => p_days), auth.uid(), p_member_id);
  return v_code;
end $$;

create or replace function public.redeem_invite_code(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_role text; v_member uuid; v_hash text; v_uid uuid := auth.uid();
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
  select id, role, member_id into v_id, v_role, v_member from public.invite_codes
   where code_hash = v_hash and not revoked and expires_at > now() and uses < max_uses
   for update;
  if v_id is null then
    insert into private.invite_attempts (user_id, success) values (v_uid, false);
    perform private.log('invite_failed', 'invite_codes', null);
    return 'invalid';
  end if;
  if v_member is not null then
    if exists (select 1 from public.members where profile_id = v_uid) then
      raise exception 'Votre compte est déjà lié à une fiche. Contactez un administrateur.';
    end if;
    update public.members set profile_id = v_uid
     where id = v_member and profile_id is null and anonymized_at is null;
    if not found then
      insert into private.invite_attempts (user_id, success) values (v_uid, false);
      return 'invalid';
    end if;
  end if;
  update public.invite_codes set uses = uses + 1 where id = v_id;
  update public.profiles set role = v_role where id = v_uid;
  insert into private.invite_attempts (user_id, success) values (v_uid, true);
  perform private.log('invite_redeemed', 'invite_codes', v_id::text,
                      jsonb_build_object('role', v_role, 'fiche_liee', v_member is not null));
  return 'ok';
end $$;

-- 3. Réponses aux séances (présence annoncée) --------------------------------
create table if not exists public.session_rsvp (
  session_id  uuid not null references public.sessions(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  status      text not null check (status in ('present','absent')),
  updated_at  timestamptz not null default now(),
  primary key (session_id, member_id)
);
create index if not exists session_rsvp_member_idx on public.session_rsvp (member_id);
alter table public.session_rsvp enable row level security;
drop policy if exists rsvp_select on public.session_rsvp;
create policy rsvp_select on public.session_rsvp for select to authenticated using (public.is_staff());
revoke all on public.session_rsvp from anon, authenticated;
grant select on public.session_rsvp to authenticated;   -- écriture uniquement via set_my_rsvp()

create or replace function public.set_my_rsvp(p_session_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mid uuid := public.my_member_id();
begin
  if not public.is_active_account() then raise exception 'Accès refusé'; end if;
  if v_mid is null then raise exception 'Votre compte n''est lié à aucune fiche membre'; end if;
  if p_status is not null and p_status not in ('present','absent') then raise exception 'Réponse invalide'; end if;
  if not exists (select 1 from public.sessions s
                 join public.course_members cm on cm.course_id = s.course_id and cm.member_id = v_mid
                 where s.id = p_session_id and s.status = 'planned' and s.date >= current_date) then
    raise exception 'Séance introuvable, passée ou hors de vos cours';
  end if;
  if p_status is null then
    delete from public.session_rsvp where session_id = p_session_id and member_id = v_mid;
  else
    insert into public.session_rsvp (session_id, member_id, status) values (p_session_id, v_mid, p_status)
    on conflict (session_id, member_id) do update set status = excluded.status, updated_at = now();
  end if;
end $$;

-- 4. Espace membre : uniquement les données de la fiche liée au compte ----------
--    p_member_id : réservé à l'administrateur (aperçu « Voir comme un membre »).
create or replace function public.member_space(p_member_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mid uuid; v_mine uuid := public.my_member_id(); res jsonb;
begin
  if not public.is_active_account() then raise exception 'Accès refusé'; end if;
  if p_member_id is not null and p_member_id is distinct from v_mine then
    if not public.is_admin() then raise exception 'Accès refusé'; end if;
    v_mid := p_member_id;
  else
    v_mid := v_mine;
  end if;
  if v_mid is null then return jsonb_build_object('linked', false); end if;

  with my_courses as (
    select course_id from public.course_members where member_id = v_mid
  ),
  sess as (   -- séances de mes cours + séances où j'ai une présence
    select s.* from public.sessions s
    where s.course_id in (select course_id from my_courses)
       or exists (select 1 from public.attendance a where a.session_id = s.id and a.member_id = v_mid)
  ),
  past as (
    select s.id, s.date, s.status, s.summary, s.course_id, a.present
    from sess s left join public.attendance a on a.session_id = s.id and a.member_id = v_mid
    where s.date <= current_date and s.status <> 'cancelled'
  )
  select jsonb_build_object(
    'linked', true,
    'member', (select jsonb_build_object('id', m.id, 'first_name', m.first_name, 'last_name', m.last_name,
                 'active', m.active, 'is_instructor', m.is_instructor) from public.members m where m.id = v_mid),
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'color', b.color, 'rank', b.rank,
                 'date', g.awarded_on, 'note', g.note) order by g.awarded_on desc, b.rank desc), '[]')
               from public.member_grades g join public.belt_levels b on b.id = g.belt_level_id where g.member_id = v_mid),
    'belts', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'color', color, 'rank', rank) order by rank), '[]')
              from public.belt_levels),
    'courses', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'name', c.name, 'level', c.level, 'location', c.location, 'weekday', c.weekday,
                  'start_time', c.start_time, 'end_time', c.end_time,
                  'instructors', (select coalesce(jsonb_agg(im.first_name || ' ' || left(im.last_name, 1) || '.'
                                    order by im.first_name), '[]')
                                  from public.course_instructors ci join public.members im on im.id = ci.member_id
                                  where ci.course_id = c.id))
                  order by c.weekday, c.start_time), '[]')
                from public.courses c where c.id in (select course_id from my_courses) and c.active),
    'upcoming', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.id, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time, 'status', s.status,
                   'course', c.name, 'location', c.location,
                   'instructor', (select im.first_name || ' ' || left(im.last_name, 1) || '.' from public.members im where im.id = s.instructor_id),
                   'rsvp', (select r.status from public.session_rsvp r where r.session_id = s.id and r.member_id = v_mid))
                   order by s.date, s.start_time), '[]')
                 from public.sessions s join public.courses c on c.id = s.course_id
                 where s.course_id in (select course_id from my_courses)
                   and s.date between current_date and current_date + 28),
    'history', (select coalesce(jsonb_agg(x.j order by x.date desc), '[]') from (
                  select p.date, jsonb_build_object(
                    'date', p.date, 'course', c.name, 'status', p.status, 'present', p.present,
                    'summary', case when p.status = 'done' then p.summary end,
                    'techniques', (select coalesce(jsonb_agg(t.name order by t.name), '[]')
                                   from public.session_techniques st join public.techniques t on t.id = st.technique_id
                                   where st.session_id = p.id)) j
                  from past p join public.courses c on c.id = p.course_id
                  order by p.date desc limit 40) x),
    'stats', (select jsonb_build_object(
                'sessions_90d', count(*) filter (where p.date > current_date - 90 and p.status = 'done'),
                'present_90d', count(*) filter (where p.date > current_date - 90 and p.present),
                'present_total', (select count(*) from public.attendance a where a.member_id = v_mid and a.present),
                'first_presence', (select min(s.date) from public.attendance a join public.sessions s on s.id = a.session_id
                                   where a.member_id = v_mid and a.present))
              from past p),
    'techniques_90d', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'category', t.category, 'count', n)
                         order by n desc, t.name), '[]')
                       from (select st.technique_id, count(*) n
                             from public.attendance a join public.sessions s on s.id = a.session_id
                             join public.session_techniques st on st.session_id = s.id
                             where a.member_id = v_mid and a.present and s.date > current_date - 90
                             group by st.technique_id) z
                       join public.techniques t on t.id = z.technique_id),
    'preview', v_mid is distinct from v_mine
  ) into res;
  return res;
end $$;

-- 5. RGPD : export de SES propres données, coordonnées personnelles -----------
create or replace function private.member_export(p_member_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
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
    'reponses_seances', (select coalesce(jsonb_agg(jsonb_build_object('date', s.date, 'cours', c.name, 'reponse', r.status) order by s.date), '[]')
                         from public.session_rsvp r join public.sessions s on s.id = r.session_id
                         join public.courses c on c.id = s.course_id where r.member_id = m.id),
    'cours_inscrits', (select coalesce(jsonb_agg(c.name order by c.name), '[]')
                       from public.course_members cm join public.courses c on c.id = cm.course_id where cm.member_id = m.id),
    'consultations_coordonnees', (select coalesce(jsonb_agg(jsonb_build_object('date', l.at, 'par', p.full_name) order by l.at), '[]')
                                  from public.audit_log l left join public.profiles p on p.id = l.actor
                                  where l.action = 'contact_read' and l.record_id = m.id::text),
    'exporte_le', now())
  from public.members m where m.id = p_member_id
$$;
revoke all on function private.member_export(uuid) from public, anon, authenticated;

create or replace function public.export_member_data(p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs'; end if;
  res := private.member_export(p_member_id);
  if res is null then raise exception 'Membre introuvable'; end if;
  perform private.log('member_export', 'members', p_member_id::text);
  return res;
end $$;

create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_mid uuid := public.my_member_id(); res jsonb;
begin
  if not public.is_active_account() then raise exception 'Accès refusé'; end if;
  res := jsonb_build_object('compte', (select jsonb_build_object('nom', p.full_name, 'role', p.role, 'cree_le', p.created_at)
                                      from public.profiles p where p.id = auth.uid()));
  if v_mid is not null then res := res || jsonb_build_object('fiche', private.member_export(v_mid)); end if;
  perform private.log('self_export', 'members', v_mid::text);
  return res;
end $$;

create or replace function public.get_my_contact()
returns table (email text, phone text, emergency text, license text)
language plpgsql security definer set search_path = '' as $$
declare v_mid uuid := public.my_member_id();
begin
  if not public.is_active_account() or v_mid is null then raise exception 'Accès refusé'; end if;
  return query
    select private.dec(c.email_enc), private.dec(c.phone_enc), private.dec(c.emergency_enc), private.dec(c.license_enc)
    from private.member_contacts c where c.member_id = v_mid;
end $$;

-- Le membre met à jour email, téléphone et contact d'urgence ; le n° de licence reste géré par le club.
create or replace function public.set_my_contact(p_email text, p_phone text, p_emergency text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mid uuid := public.my_member_id();
begin
  if not public.is_active_account() or v_mid is null then raise exception 'Accès refusé'; end if;
  if coalesce(char_length(p_email), 0) > 254 or coalesce(char_length(p_phone), 0) > 30
     or coalesce(char_length(p_emergency), 0) > 200 then
    raise exception 'Valeur trop longue';
  end if;
  insert into private.member_contacts as c (member_id, email_enc, phone_enc, emergency_enc, updated_by)
  values (v_mid, private.enc(nullif(btrim(p_email), '')), private.enc(nullif(btrim(p_phone), '')),
          private.enc(nullif(btrim(p_emergency), '')), auth.uid())
  on conflict (member_id) do update
    set email_enc = excluded.email_enc, phone_enc = excluded.phone_enc, emergency_enc = excluded.emergency_enc,
        updated_at = now(), updated_by = auth.uid();
  perform private.log('contact_self_update', 'member_contacts', v_mid::text);
end $$;

-- 6. Anonymisation : efface aussi les réponses aux séances et les codes liés ----
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
  delete from public.session_rsvp where member_id = p_member_id;
  update public.invite_codes set revoked = true where member_id = p_member_id and not revoked;
  perform private.log('member_anonymize', 'members', p_member_id::text);
end $$;

-- 7. Privilèges --------------------------------------------------------------
revoke all on function public.is_active_account(), public.set_my_rsvp(uuid, text), public.member_space(uuid),
  public.export_my_data(), public.get_my_contact(), public.set_my_contact(text, text, text),
  public.create_invite_code(text, integer, integer, text, uuid) from public, anon;
grant execute on function public.is_active_account(), public.set_my_rsvp(uuid, text), public.member_space(uuid),
  public.export_my_data(), public.get_my_contact(), public.set_my_contact(text, text, text),
  public.create_invite_code(text, integer, integer, text, uuid) to authenticated;

notify pgrst, 'reload schema';

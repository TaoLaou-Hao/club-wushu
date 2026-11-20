-- Migration 005 : « cours à pourvoir ».
-- Une séance planifiée, sans intervenant, dont le début est dans les 24 h et qui a au moins
-- une déclaration de présence, apparaît aux enseignants habilités sur ce cours.
-- Le premier qui la prend en devient l'intervenant.
-- Idempotente. À exécuter après 002, 003 et 004.

-- 1. Liste des séances à pourvoir, limitée à ce que l'appelant peut prendre --------
create or replace function public.open_sessions_to_fill()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mid uuid := public.my_member_id();
begin
  if not public.is_staff() then raise exception 'Accès réservé aux enseignants'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time,
             'course', c.name, 'location', c.location,
             'declared', (select count(*) from public.session_rsvp r
                          where r.session_id = s.id and r.status = 'present'))
           order by s.date, s.start_time)
    from public.sessions s
    join public.courses c on c.id = s.course_id
    where s.status = 'planned'
      and s.instructor_id is null
      and (s.date + s.start_time) >= localtimestamp
      and (s.date + s.start_time) <= localtimestamp + interval '24 hours'
      and exists (select 1 from public.session_rsvp r where r.session_id = s.id and r.status = 'present')
      and (public.is_admin() or exists (
            select 1 from public.course_instructors ci
            where ci.course_id = s.course_id and ci.member_id = v_mid))
  ), '[]'::jsonb);
end $$;

-- 2. Prise en charge : seul un enseignant habilité sur le cours peut la prendre -----
--    La garde guard_session (migration 003) revérifie l'habilitation à l'écriture.
create or replace function public.claim_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mid uuid := public.my_member_id(); v_course uuid;
begin
  if not public.is_staff() or v_mid is null then raise exception 'Accès refusé'; end if;
  select s.course_id into v_course from public.sessions s
   where s.id = p_session_id and s.status = 'planned' and s.instructor_id is null
     and (s.date + s.start_time) >= localtimestamp - interval '1 hour'
   for update;
  if v_course is null then raise exception 'Séance déjà prise ou introuvable'; end if;
  if not (public.is_admin() or exists (
        select 1 from public.course_instructors ci where ci.course_id = v_course and ci.member_id = v_mid)) then
    raise exception 'Vous n''êtes pas habilité à enseigner ce cours';
  end if;
  update public.sessions set instructor_id = v_mid where id = p_session_id;
  perform private.log('session_claim', 'sessions', p_session_id::text);
end $$;

revoke all on function public.open_sessions_to_fill(), public.claim_session(uuid) from public, anon;
grant execute on function public.open_sessions_to_fill(), public.claim_session(uuid) to authenticated;

notify pgrst, 'reload schema';

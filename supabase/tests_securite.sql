-- Tests de sécurité (Postgres local uniquement, NE PAS exécuter sur Supabase).
-- Ordre : tests_stub_local.sql, schema.sql, puis ce fichier.
\set ON_ERROR_STOP 0
\set QUIET 1
-- users
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@x.fr','{"full_name":"Tao Admin"}'),
 ('00000000-0000-0000-0000-00000000000b','prof@x.fr','{"name":"Prof Un"}'),
 ('00000000-0000-0000-0000-00000000000c','pending@x.fr','{}'),
 ('00000000-0000-0000-0000-00000000000d','prof2@x.fr','{"full_name":"Prof Deux"}');
update public.profiles set role='admin' where id='00000000-0000-0000-0000-00000000000a';
\echo '== T1 bootstrap admin by SQL editor'
select role from profiles where id='00000000-0000-0000-0000-00000000000a';

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

\echo '== T2 pending tries to self-promote (expect ERROR)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); set role authenticated;
update profiles set role='admin' where id=auth.uid();
\echo '== T3 pending sees members/profiles count (expect 0 members, 1 profile)'
select (select count(*) from members) m, (select count(*) from profiles) p;
\echo '== T3b pending calls list_users (expect ERROR)'
select * from list_users();
reset role;

\echo '== T4 admin creates codes'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select create_invite_code('prof un', 7, 1) as code \gset
select create_invite_code('prof deux', 7, 1) as code2 \gset
select count(*) as codes, bool_and(code_hash !~ '^WS-') hashed_only from invite_codes;
reset role;
\echo '== T5 pending redeems wrong then right code'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select redeem_invite_code('WS-FAKE-FAKE-FAKE-FAKE');
select redeem_invite_code(lower(:'code'));
select role from profiles where id=auth.uid();
reset role;
\echo '== T6 reuse single-use code by another user (expect invalid), then rate limit'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); set role authenticated;
select redeem_invite_code(:'code');
select redeem_invite_code('x'); select redeem_invite_code('x'); select redeem_invite_code('x'); select redeem_invite_code('x');
select redeem_invite_code(:'code2');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); set role authenticated;
select redeem_invite_code(:'code2');
reset role;

\echo '== T7 admin creates course, instructor, members, sessions'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
insert into courses (id,name,weekday,start_time,end_time,start_date) values ('10000000-0000-0000-0000-000000000001','Taolu débutants',3,'19:00','20:30','2026-11-01');
insert into course_instructors values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b');
insert into members (id,first_name,last_name,birth_year) values ('20000000-0000-0000-0000-000000000001','Léa','Martin',2010),('20000000-0000-0000-0000-000000000002','Hugo','Petit',2008);
insert into course_members values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
select generate_sessions('2026-11-01','2026-11-30') as created;
select generate_sessions('2026-11-01','2026-11-30') as created_again;
select set_member_contact('20000000-0000-0000-0000-000000000001','lea@x.fr','0600000000','Maman 0611111111','LIC123');
reset role;
\echo '== T8 ciphertext at rest (expect no plaintext)'
select position('lea@x.fr' in encode(email_enc,'escape'))=0 as encrypted from private.member_contacts;

\echo '== T9 qualified teacher ticks attendance, writes log'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select id as sid from sessions order by date limit 1 \gset
insert into attendance (session_id, member_id, present) values (:'sid','20000000-0000-0000-0000-000000000001', true);
update sessions set summary='Jibengong + taolu', status='done', instructor_id=auth.uid() where id=:'sid';
select status, summary from sessions where id=:'sid';
\echo '== T10 teacher moves session date (expect ERROR)'
update sessions set date=date+1 where id=:'sid';
\echo '== T11 teacher reads contact (ok), private table (ERROR), audit (0), invite codes (0), list_users (ERROR)'
select * from get_member_contact('20000000-0000-0000-0000-000000000001');
select * from private.member_contacts;
select count(*) audit_visible from audit_log;
select count(*) codes_visible from invite_codes;
select * from list_users();
\echo '== T12 teacher inserts session (expect ERROR) / self-promotes (ERROR) / generate (ERROR)'
insert into sessions (course_id,date,start_time,end_time) values ('10000000-0000-0000-0000-000000000001','2026-12-02','19:00','20:00');
update profiles set role='admin' where id=auth.uid();
select generate_sessions('2026-12-01','2026-12-31');
\echo '== T12b teacher spoofs marked_by (expect marked_by = self)'
update attendance set marked_by='00000000-0000-0000-0000-00000000000a' where session_id=:'sid';
select marked_by from attendance where session_id=:'sid';
reset role;

\echo '== T13 unqualified teacher (prof2) ticks attendance (expect ERROR rls) & update session (0 rows)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); set role authenticated;
select role from profiles where id=auth.uid();
insert into attendance (session_id, member_id, present) values (:'sid','20000000-0000-0000-0000-000000000002', true);
update sessions set summary='hack' where id=:'sid';
select summary from sessions where id=:'sid';
\echo '== T13b prof2 assigns himself as instructor via qualified? (expect 0 rows)'
update sessions set instructor_id=auth.uid() where id=:'sid';
reset role;

\echo '== T14 anon reads members (ERROR) and keepalive (1)'
set role anon;
select count(*) from members;
select keepalive();
select redeem_invite_code('x');
reset role;

\echo '== T15 last admin protection, role change, audit'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select set_user_role('00000000-0000-0000-0000-00000000000a','teacher');
select set_user_role('00000000-0000-0000-0000-00000000000d','pending');
select role from profiles where id='00000000-0000-0000-0000-00000000000d';
select action, count(*) from audit_log group by 1 order by 1;
\echo '== T16 export + anonymize + retention'
select export_member_data('20000000-0000-0000-0000-000000000001')->'coordonnees' as export_contact;
select anonymize_member('20000000-0000-0000-0000-000000000001');
select first_name, active, anonymized_at is not null anon from members where id='20000000-0000-0000-0000-000000000001';
select count(*) contacts_left from get_member_contact('20000000-0000-0000-0000-000000000001');
update members set anonymized_at=null where id='20000000-0000-0000-0000-000000000001';
select anonymized_at is not null still_anon from members where id='20000000-0000-0000-0000-000000000001';
select apply_retention(3,365);
\echo '== T17 resync after schedule change to Friday'
update courses set weekday=5 where id='10000000-0000-0000-0000-000000000001';
select resync_course_sessions('10000000-0000-0000-0000-000000000001', 4);
select date, extract(isodow from date) dow, status from sessions order by date;
\echo '== T18 delete user'
select delete_user('00000000-0000-0000-0000-00000000000c');
select count(*) from profiles;
reset role;
\echo '== T19 audit records contain no personal values'
select count(*) leaks from audit_log where details::text ilike '%lea%' or details::text ilike '%martin%' or record_id ilike '%lea%';
\set QUIET 1
\echo '== T20 audit-fix checks'
insert into auth.users (id,email) values ('00000000-0000-0000-0000-00000000000e','prof3@x.fr');
update profiles set role='teacher' where id='00000000-0000-0000-0000-00000000000e';
insert into members (id,first_name,last_name) values ('20000000-0000-0000-0000-000000000003','Zoé','Durand');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e'); set role authenticated;
\echo 'E1 unrelated teacher reads contact (expect ERROR)'
select * from get_member_contact('20000000-0000-0000-0000-000000000003');
\echo 'E2 de-anonymize (expect ERROR) / rename unrelated (expect 0 rows)'
update members set first_name='Léa' where id='20000000-0000-0000-0000-000000000001';
update members set first_name='X' where id='20000000-0000-0000-0000-000000000003';
select first_name from members where id='20000000-0000-0000-0000-000000000003';
\echo 'M2 grade unrelated member (expect ERROR)'
insert into member_grades (member_id, belt_level_id) select '20000000-0000-0000-0000-000000000003', id from belt_levels limit 1;
\echo 'own created member: allowed, left_at forced'
insert into members (id,first_name,last_name) values ('20000000-0000-0000-0000-000000000004','Nina','Roux');
update members set active=false, left_at='2000-01-01' where id='20000000-0000-0000-0000-000000000004';
select left_at = current_date as left_at_forced from members where id='20000000-0000-0000-0000-000000000004';
select set_member_contact('20000000-0000-0000-0000-000000000004','n@x.fr',null,null,null);
select set_member_contact('20000000-0000-0000-0000-000000000004',null,null,null,null);
\echo 'future grade (expect ERROR)'
insert into member_grades (member_id, belt_level_id, awarded_on) select '20000000-0000-0000-0000-000000000004', id, current_date+10 from belt_levels limit 1;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
\echo 'F4 admin extends code (expect ERROR), revoke ok'
update invite_codes set expires_at = now() + interval '5 years';
update invite_codes set revoked = true;
select bool_and(revoked) from invite_codes;
\echo 'F3 resync 5000 weeks (expect ERROR)'
select resync_course_sessions('10000000-0000-0000-0000-000000000001', 5000);
\echo 'export includes enrolments + reads'
select export_member_data('20000000-0000-0000-0000-000000000004') ? 'consultations_coordonnees' as ok;
select apply_retention(3,365);
reset role;
\echo 'F2 truncate audit as authenticated (expect ERROR)'
set role authenticated; truncate audit_log; reset role;
\echo '== T30 compte lié'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e'); set role authenticated;
\echo 'teacher links own fiche at insert (expect profile_id null)'
insert into members (id,first_name,last_name,profile_id) values ('20000000-0000-0000-0000-000000000009','Moi','Prof','00000000-0000-0000-0000-00000000000e');
select profile_id is null as not_linked from members where id='20000000-0000-0000-0000-000000000009';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
\echo 'admin links fiche (ok)'
update members set profile_id='00000000-0000-0000-0000-00000000000e' where id='20000000-0000-0000-0000-000000000009';
select profile_id is not null as linked from members where id='20000000-0000-0000-0000-000000000009';
\echo 'admin self fiche + self grade (ok)'
insert into members (id,first_name,last_name,profile_id) values ('20000000-0000-0000-0000-00000000000a','Tao','Admin','00000000-0000-0000-0000-00000000000a');
insert into member_grades (member_id, belt_level_id) select '20000000-0000-0000-0000-00000000000a', id from belt_levels where name='Noire';
select count(*) admin_grades from member_grades where member_id='20000000-0000-0000-0000-00000000000a';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e'); set role authenticated;
\echo 'teacher self-grade (expect ERROR)'
insert into member_grades (member_id, belt_level_id) select '20000000-0000-0000-0000-000000000009', id from belt_levels where name='Noire';
\echo 'teacher unlinks/relinks (expect unchanged)'
update members set profile_id=null where id='20000000-0000-0000-0000-000000000009';
select profile_id is not null as still_linked from members where id='20000000-0000-0000-0000-000000000009';
reset role;

-- ===== Migration 003 (charger : stub, schema.sql, 002, données t003.sql, 003, puis ces tests) =====
\set QUIET 1
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
-- données "avant migration" : admin a, prof b (habilité, a pris une séance)
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@x.fr','{"full_name":"Tao Laou-Hao"}'),
 ('00000000-0000-0000-0000-00000000000b','prof@x.fr','{"full_name":"Li Wei"}'),
 ('00000000-0000-0000-0000-00000000000c','prof2@x.fr','{"full_name":"Sans Habilitation"}');
update profiles set role='admin' where id='00000000-0000-0000-0000-00000000000a';
update profiles set role='teacher' where id in ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c');
insert into courses (id,name,weekday,start_time,end_time,start_date) values ('10000000-0000-0000-0000-000000000001','Taolu',3,'19:00','20:30','2026-11-01');
insert into course_instructors values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b');
insert into members (id,first_name,last_name) values ('20000000-0000-0000-0000-000000000001','Léa','Martin');
insert into course_members values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into sessions (id,course_id,date,start_time,end_time,instructor_id) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',current_date + 7,'19:00','20:30','00000000-0000-0000-0000-00000000000b');
\set QUIET 1
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\echo '== migrated data'
select first_name, last_name, is_instructor, profile_id is not null linked from members order by first_name;
select (select first_name from members where id=ci.member_id) from course_instructors ci;
select (select first_name from members where id=s.instructor_id) instr from sessions s;
\echo '== prof b (linked instructor) ticks attendance: ok'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
insert into attendance (session_id, member_id) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
select count(*) att from attendance;
select my_member_id() is not null as has_member;
\echo 'prof b sets himself instructor flag on another fiche (ignored)'
update members set is_instructor=true where id='20000000-0000-0000-0000-000000000001';
reset role;
select is_instructor as lea_instructor from members where id='20000000-0000-0000-0000-000000000001';
\echo '== prof c (no fiche) ticks: ERROR'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); set role authenticated;
insert into attendance (session_id, member_id) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001') on conflict do nothing;
update attendance set present=false;
reset role;
select bool_and(present) still_present from attendance;
\echo '== admin: instructor without account'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
insert into members (id,first_name,last_name,is_instructor) values ('20000000-0000-0000-0000-000000000002','Chen','Sans-Compte',true);
insert into course_instructors values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
update sessions set instructor_id='20000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000001';
select (select first_name from members where id=instructor_id) from sessions;
\echo 'non-instructor fiche as course instructor: ERROR'
insert into course_instructors values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
\echo 'session instructor not qualified: ERROR'
update sessions set instructor_id='20000000-0000-0000-0000-000000000001';
\echo 'unflag instructor removes qualification'
update members set is_instructor=false where id='20000000-0000-0000-0000-000000000002';
select count(*) ci_left from course_instructors;
select instructor_id is null as cleared from sessions;
reset role;

-- TESTS LOCAUX UNIQUEMENT : NE PAS EXÉCUTER DANS SUPABASE (crée de faux comptes).
\set QUIET 1
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
insert into auth.users (id,email) values
 ('00000000-0000-0000-0000-00000000000a','admin@x'),('00000000-0000-0000-0000-00000000000b','prof@x'),
 ('00000000-0000-0000-0000-00000000000f','prof2@x'),('00000000-0000-0000-0000-00000000000c','mem@x');
update profiles set role='admin' where id='00000000-0000-0000-0000-00000000000a';
update profiles set role='teacher' where id in ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000f');
update profiles set role='member' where id='00000000-0000-0000-0000-00000000000c';
insert into members (id,first_name,last_name,profile_id,is_instructor) values
 ('20000000-0000-0000-0000-000000000001','Léa','Martin','00000000-0000-0000-0000-00000000000c',false),
 ('20000000-0000-0000-0000-000000000002','Paul','Habilité','00000000-0000-0000-0000-00000000000b',true),
 ('20000000-0000-0000-0000-000000000005','Eva','NonHabilitée','00000000-0000-0000-0000-00000000000f',true);
insert into courses (id,name,weekday,start_time,end_time,start_date) values ('10000000-0000-0000-0000-000000000001','Taolu',1,'19:00','20:30',current_date-60),('10000000-0000-0000-0000-000000000002','Autre',2,'19:00','20:30',current_date-60);
insert into course_instructors values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
insert into course_members values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
-- séance dans ~3h sans intervenant, 1 déclaration ; séance dans 3 jours ; séance dans 3h sans déclaration
insert into sessions (id,course_id,date,start_time,end_time,status) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(localtimestamp+interval '3 hours')::date,(localtimestamp+interval '3 hours')::time,(localtimestamp+interval '4 hours')::time,'planned'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',current_date+3,'19:00','20:30','planned'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',(localtimestamp+interval '5 hours')::date,(localtimestamp+interval '5 hours')::time,(localtimestamp+interval '6 hours')::time,'planned');
insert into session_rsvp values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','present'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','present');

\echo '== habilité : voit 1 séance (pas celle à 3 j, pas celle sans déclaration)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select jsonb_array_length(open_sessions_to_fill()) n, open_sessions_to_fill()->0->>'declared' declared;
\echo '== non habilité : voit 0'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select jsonb_array_length(open_sessions_to_fill()) n;
\echo 'non habilité prend : ERREUR'
select claim_session('30000000-0000-0000-0000-000000000001');
\echo '== membre : ERREUR x2'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select open_sessions_to_fill();
select claim_session('30000000-0000-0000-0000-000000000001');
\echo '== habilité prend'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select claim_session('30000000-0000-0000-0000-000000000001');
select jsonb_array_length(open_sessions_to_fill()) n_after;
\echo 'reprise par autre : ERREUR (déjà prise)'
select claim_session('30000000-0000-0000-0000-000000000001');
reset role;
select instructor_id is not null taken from sessions where id='30000000-0000-0000-0000-000000000001';
\echo '== admin voit les séances à pourvoir'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select jsonb_array_length(open_sessions_to_fill()) n_admin;
reset role;

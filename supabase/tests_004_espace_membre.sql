\set ON_ERROR_STOP 0
\set QUIET 1
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
insert into vault.secrets values ('club_data_key','k3y-for-tests-0123456789abcdef','');
insert into auth.users (id,email) values
 ('00000000-0000-0000-0000-00000000000a','admin@x'),('00000000-0000-0000-0000-00000000000b','prof@x'),
 ('00000000-0000-0000-0000-00000000000c','mem@x'),('00000000-0000-0000-0000-00000000000d','new@x'),
 ('00000000-0000-0000-0000-00000000000e','other@x');
update profiles set role='admin' where id='00000000-0000-0000-0000-00000000000a';
update profiles set role='teacher' where id='00000000-0000-0000-0000-00000000000b';
update profiles set role='member' where id='00000000-0000-0000-0000-00000000000c';
insert into members (id,first_name,last_name,profile_id,is_instructor) values
 ('20000000-0000-0000-0000-000000000001','Léa','Martin','00000000-0000-0000-0000-00000000000c',false),
 ('20000000-0000-0000-0000-000000000002','Paul','Prof','00000000-0000-0000-0000-00000000000b',true),
 ('20000000-0000-0000-0000-000000000003','Noé','SansCompte',null,false),
 ('20000000-0000-0000-0000-000000000004','Zoé','Autre',null,false);
insert into courses (id,name,weekday,start_time,end_time,start_date) values ('10000000-0000-0000-0000-000000000001','Taolu',1,'19:00','20:30',current_date-60);
insert into course_instructors values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
insert into course_members values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004');
insert into sessions (id,course_id,date,start_time,end_time,status,summary,notes,instructor_id) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',current_date-7,'19:00','20:30','done','Travail des bases','NOTE INTERNE','20000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',current_date+7,'19:00','20:30','planned',null,null,null);
insert into attendance (session_id,member_id,present) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',true),('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',false);
insert into session_techniques select '30000000-0000-0000-0000-000000000001', id from techniques limit 2;
insert into member_grades (member_id,belt_level_id) select '20000000-0000-0000-0000-000000000001', id from belt_levels where rank=2;

\echo '== MEMBER: direct table access returns nothing'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); set role authenticated;
select (select count(*) from members) m, (select count(*) from sessions) s, (select count(*) from attendance) a, (select count(*) from member_grades) g, (select count(*) from session_rsvp) r;
\echo 'member writes attendance: ERROR/0'
insert into attendance (session_id,member_id) values ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
\echo 'member writes rsvp table directly: ERROR'
insert into session_rsvp values ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','absent');
\echo '== member_space own'
select s->'member'->>'first_name' who, jsonb_array_length(s->'courses') courses, jsonb_array_length(s->'upcoming') upc,
       jsonb_array_length(s->'history') hist, s->'history'->0->>'summary' summ, s::text like '%NOTE INTERNE%' leaks_notes,
       s::text like '%Zoé%' leaks_other, s->'stats' stats, jsonb_array_length(s->'techniques_90d') tech, s->'courses'->0->'instructors' instr
from (select member_space() s) x;
\echo 'member_space of other member: ERROR'
select member_space('20000000-0000-0000-0000-000000000004');
\echo '== rsvp'
select set_my_rsvp('30000000-0000-0000-0000-000000000002','absent');
select member_space()->'upcoming'->0->>'rsvp' rsvp;
\echo 'rsvp past session: ERROR'
select set_my_rsvp('30000000-0000-0000-0000-000000000001','absent');
\echo 'rsvp invalid: ERROR'
select set_my_rsvp('30000000-0000-0000-0000-000000000002','maybe');
\echo '== contact'
select set_my_contact('lea@x.fr','0600','maman 0611');
select * from get_my_contact();
\echo 'member uses staff contact RPC on other: ERROR'
select * from get_member_contact('20000000-0000-0000-0000-000000000004');
\echo 'member export'
select (e->'fiche'->'membre'->>'first_name') n, jsonb_array_length(e->'fiche'->'reponses_seances') r from (select export_my_data() e) x;
\echo 'member cannot set role / create code: ERROR x2'
select set_user_role('00000000-0000-0000-0000-00000000000c','admin');
select create_invite_code('x',7,1,'member',null);
update profiles set role='admin' where id='00000000-0000-0000-0000-00000000000c';
reset role;
select role from profiles where id='00000000-0000-0000-0000-00000000000c';

\echo '== TEACHER sees rsvp'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); set role authenticated;
select count(*) rsvp_seen from session_rsvp;
select member_space()->'linked' teacher_linked;
\echo 'teacher member_space other: ERROR'
select member_space('20000000-0000-0000-0000-000000000001');
reset role;

\echo '== ADMIN preview + activation code'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select member_space('20000000-0000-0000-0000-000000000001')->>'preview' preview;
\echo 'admin code role admin: ERROR'
select create_invite_code('x',7,1,'admin',null);
\echo 'activation code on linked fiche: ERROR'
select create_invite_code('x',7,1,'member','20000000-0000-0000-0000-000000000001');
create temp table code as select create_invite_code('Noé',7,5,'member','20000000-0000-0000-0000-000000000003') c;
select max_uses, role, member_id is not null linked from invite_codes;
reset role;
grant select on code to authenticated;
\echo '== new user redeems activation code'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); set role authenticated;
select redeem_invite_code((select c from code));
select member_space()->'member'->>'first_name' fiche;
reset role;
select role from profiles where id='00000000-0000-0000-0000-00000000000d';
\echo 'second user same code: invalid'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e'); set role authenticated;
select redeem_invite_code((select c from code));
select member_space() pending_space;
reset role;
\echo '== anonymize cleans rsvp'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); set role authenticated;
select anonymize_member('20000000-0000-0000-0000-000000000001');
reset role;
select count(*) rsvp_left from session_rsvp;

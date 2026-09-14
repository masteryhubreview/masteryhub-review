-- ReviewHub schema. Run once in a NEW Supabase project's SQL editor.
-- All new files. Supersedes the discussion-only schema from the planning response.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create table public.terms(id uuid primary key default gen_random_uuid(),name text not null unique,is_active boolean not null default true,created_at timestamptz not null default now());
create table public.profiles(id uuid primary key references auth.users(id) on delete restrict,email text not null,display_name text not null,student_number text unique,role text not null default 'student' check(role in ('student','admin')),is_active boolean not null default true,term_id uuid references public.terms(id) on delete restrict,created_at timestamptz not null default now());
create table public.subjects(id uuid primary key default gen_random_uuid(),name text not null,code text not null default '',description text not null default '',is_active boolean not null default true,created_at timestamptz not null default now());
create table public.enrollments(id uuid primary key default gen_random_uuid(),student_id uuid not null references public.profiles(id) on delete restrict,subject_id uuid not null references public.subjects(id) on delete restrict,term_id uuid not null references public.terms(id) on delete restrict,is_active boolean not null default true,created_at timestamptz not null default now(),unique(student_id,subject_id,term_id));
create index enrollments_access on public.enrollments(student_id,subject_id) where is_active;
create table public.questions(id uuid primary key default gen_random_uuid(),subject_id uuid not null references public.subjects(id) on delete restrict,data jsonb not null,is_active boolean not null default true,created_at timestamptz not null default now());
create index questions_subject on public.questions(subject_id,created_at desc);
create extension if not exists pg_trgm with schema extensions;
create index questions_search on public.questions using gin ((data->>'text') extensions.gin_trgm_ops);
create table public.reviewers(id uuid primary key default gen_random_uuid(),subject_id uuid not null references public.subjects(id) on delete restrict,title text not null,description text not null default '',published boolean not null default false,settings jsonb not null,created_at timestamptz not null default now());
create index reviewers_subject on public.reviewers(subject_id,published);
create table public.reviewer_questions(reviewer_id uuid not null references public.reviewers(id) on delete cascade,question_id uuid not null references public.questions(id) on delete restrict,position integer not null,primary key(reviewer_id,question_id));
create table public.attempts(id uuid primary key default gen_random_uuid(),student_id uuid not null references public.profiles(id) on delete restrict,reviewer_id uuid not null references public.reviewers(id) on delete restrict,subject_id uuid not null references public.subjects(id) on delete restrict,title text not null,attempt_number integer not null,status text not null default 'in_progress' check(status in ('in_progress','pending_review','graded')),settings jsonb not null,snapshot jsonb not null,responses jsonb not null default '{}',grades jsonb not null default '{}',score numeric not null default 0,max_score numeric not null,pending integer not null default 0,started_at timestamptz not null default now(),submitted_at timestamptz,unique(student_id,reviewer_id,attempt_number));
create unique index one_active_attempt on public.attempts(student_id,reviewer_id) where status='in_progress';
create index attempts_student on public.attempts(student_id,started_at desc);
create index attempts_admin on public.attempts(status,subject_id,started_at desc);
create table public.settings(id integer primary key default 1 check(id=1),system_name text not null default 'ReviewHub',tagline text not null default 'Learn. Practice. Improve.',welcome text not null default 'Welcome to ReviewHub! Select one of your enrolled subjects to start reviewing.',instructions text not null default 'Take your time. Review each question carefully, and keep practicing.',logo_path text);
insert into public.settings(id) values(1);
create table public.grade_audit(id bigint generated always as identity primary key,attempt_id uuid not null references public.attempts(id),question_id text not null,admin_id uuid not null references public.profiles(id),old_grade jsonb,new_grade jsonb not null,created_at timestamptz not null default now());
create table private.rate_limits(actor uuid not null,bucket bigint not null,hits integer not null,primary key(actor,bucket));
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active)$$;
create function private.is_active() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and is_active)$$;
create function private.has_subject(s uuid) returns boolean language sql stable security definer set search_path='' as $$select private.is_active() and exists(select 1 from public.enrollments e join public.terms t on t.id=e.term_id join public.subjects s2 on s2.id=e.subject_id where e.student_id=auth.uid() and e.subject_id=s and e.is_active and t.is_active and s2.is_active)$$;
create function private.sync_profile() returns trigger language plpgsql security definer set search_path='' as $$begin
if TG_OP='INSERT' then insert into public.profiles(id,email,display_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name','Student'));
else update public.profiles set email=new.email where id=new.id;end if;return new;end$$;
create trigger on_auth_created after insert on auth.users for each row execute function private.sync_profile();
create trigger on_auth_email after update of email on auth.users for each row execute function private.sync_profile();
create function private.validate_question() returns trigger language plpgsql set search_path='' as $$declare q jsonb:=new.data;c jsonb;a jsonb;t text:=new.data->>'type';n integer;begin
if t not in ('mc_single','mc_multi','fill_blank','short_answer','long_answer','multi_blank') or t is null then raise exception 'Invalid question type';end if;
if coalesce(length(trim(q->>'text')),0)=0 or length(q->>'text')>20000 then raise exception 'Question text required (maximum 20000 characters)';end if;
if jsonb_typeof(q->'points') is distinct from 'number' or (q->>'points')::numeric<=0 or (q->>'points')::numeric>10000 then raise exception 'Points out of range';end if;
if jsonb_typeof(q->'strict') is distinct from 'boolean' then raise exception 'strict must be boolean';end if;
if jsonb_typeof(q->'choices') is distinct from 'array' or jsonb_typeof(q->'correct') is distinct from 'array' or jsonb_typeof(q->'accepted') is distinct from 'array' then raise exception 'Answer lists required';end if;
if t like 'mc_%' then
if jsonb_array_length(q->'choices')<2 or jsonb_array_length(q->'correct')<1 then raise exception 'Choices and correct answers required';end if;
select count(distinct x->>'id') into n from jsonb_array_elements(q->'choices')x;
if n<>jsonb_array_length(q->'choices') then raise exception 'Choice IDs must be unique';end if;
for c in select * from jsonb_array_elements(q->'choices') loop if coalesce(length(c->>'id'),0)=0 or coalesce(length(trim(c->>'text')),0)=0 then raise exception 'Empty choice';end if;end loop;
for c in select * from jsonb_array_elements(q->'correct') loop if jsonb_typeof(c)<>'string' or not exists(select 1 from jsonb_array_elements(q->'choices')x where x->>'id'=c#>>'{}') then raise exception 'Invalid correct choice';end if;end loop;
select count(distinct x) into n from jsonb_array_elements_text(q->'correct')x;
if n<>jsonb_array_length(q->'correct') then raise exception 'Duplicate correct answer';end if;
if t='mc_single' and n<>1 then raise exception 'One correct answer required';end if;end if;
if t in ('fill_blank','multi_blank') and jsonb_array_length(q->'accepted')=0 then raise exception 'Accepted answers required';end if;
if t in ('fill_blank','short_answer') and jsonb_array_length(q->'accepted')>1 then raise exception 'One text field required';end if;
for a in select * from jsonb_array_elements(q->'accepted') loop
if jsonb_typeof(a)<>'array' or jsonb_array_length(a)=0 then raise exception 'Each blank needs accepted variants';end if;
for c in select * from jsonb_array_elements(a) loop if jsonb_typeof(c)<>'string' or length(trim(c#>>'{}'))=0 then raise exception 'Empty answer variant';end if;end loop;end loop;
return new;end$$;
create trigger validate_question before insert or update on public.questions for each row execute function private.validate_question();
create function private.validate_reviewer() returns trigger language plpgsql set search_path='' as $$declare s jsonb:=new.settings;k text;begin
if length(trim(new.title))=0 then raise exception 'Title required';end if;
if coalesce(s->>'selection','') not in ('fixed','random') then raise exception 'Selection required';end if;
foreach k in array array['shuffle_questions','shuffle_choices','require_all','instant','allow_review','show_correct'] loop if jsonb_typeof(s->k) is distinct from 'boolean' then raise exception 'Boolean setting missing: %',k;end if;end loop;
if s->>'selection'='random' and (coalesce((s->>'count')::integer,0)<1) then raise exception 'Random count must be positive';end if;
if s->>'max_attempts' is not null and (s->>'max_attempts')::integer<1 then raise exception 'Invalid attempt limit';end if;
if TG_OP='UPDATE' and new.subject_id<>old.subject_id and exists(select 1 from public.reviewer_questions where reviewer_id=old.id) then raise exception 'Remove the question pool before changing subjects';end if;
return new;end$$;
create trigger validate_reviewer before insert or update on public.reviewers for each row execute function private.validate_reviewer();
create function private.validate_enrollment() returns trigger language plpgsql set search_path='' as $$begin
if not exists(select 1 from public.profiles where id=new.student_id and role='student') then raise exception 'Only students may be enrolled';end if;return new;end$$;
create trigger validate_enrollment before insert or update on public.enrollments for each row execute function private.validate_enrollment();
-- Enable RLS on every exposed table. No student direct access to answer keys or attempts.
do $$declare t text;begin foreach t in array array['profiles','terms','subjects','enrollments','questions','reviewers','reviewer_questions','attempts','settings','grade_audit'] loop execute format('alter table public.%I enable row level security',t);end loop;end$$;
create policy admin_profiles on public.profiles for all to authenticated using(private.is_admin()) with check(private.is_admin());
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
do $$declare t text;begin foreach t in array array['terms','subjects','enrollments','questions','reviewers','reviewer_questions','settings'] loop execute format('create policy admin_manage on public.%I for all to authenticated using(private.is_admin()) with check(private.is_admin())',t);end loop;end$$;
create policy admin_attempts on public.attempts for select to authenticated using(private.is_admin());
create policy admin_audit on public.grade_audit for select to authenticated using(private.is_admin());
create policy student_subjects on public.subjects for select to authenticated using(private.has_subject(id));
create policy student_reviewers on public.reviewers for select to authenticated using(published and private.has_subject(subject_id));
create policy student_settings on public.settings for select to authenticated using(private.is_active());
create policy own_enrollments on public.enrollments for select to authenticated using(student_id=auth.uid() and private.is_active());
grant select,insert,update,delete on public.profiles,public.terms,public.subjects,public.enrollments,public.questions,public.reviewers,public.reviewer_questions,public.settings to authenticated;
grant select on public.attempts,public.grade_audit to authenticated;
revoke all on public.attempts,public.grade_audit from anon;
-- Per-user database-backed throttle for account-management route.
create function public.admin_rate_limit() returns void language plpgsql security definer set search_path='' as $$declare n integer;b bigint:=floor(extract(epoch from now())/60);begin
if not private.is_admin() then raise exception 'Administrator required';end if;
insert into private.rate_limits values(auth.uid(),b,1) on conflict(actor,bucket) do update set hits=private.rate_limits.hits+1 returning hits into n;
if n>120 then raise exception 'Please wait a minute before more account changes';end if;
delete from private.rate_limits where bucket<b-60;end$$;
create function public.set_display_name(new_name text) returns void language plpgsql security definer set search_path='' as $$begin if not private.is_active() or length(trim(new_name)) not between 1 and 120 then raise exception 'Invalid display name';end if;update public.profiles set display_name=trim(new_name) where id=auth.uid();end$$;
create function public.save_reviewer(reviewer uuid,subject uuid,name text,description_text text,options jsonb,question_ids uuid[],publish boolean) returns uuid language plpgsql security definer set search_path='' as $$declare result uuid:=coalesce(reviewer,gen_random_uuid());begin
if not private.is_admin() then raise exception 'Administrator required';end if;
if cardinality(question_ids)<> (select count(distinct x) from unnest(question_ids)x) then raise exception 'Duplicate pool questions';end if;
if exists(select 1 from unnest(question_ids)x where not exists(select 1 from public.questions where id=x and subject_id=subject and is_active)) then raise exception 'Pool questions must be active and belong to the subject';end if;
if publish and (cardinality(question_ids)=0 or (options->>'selection'='random' and (options->>'count')::int>cardinality(question_ids))) then raise exception 'Not enough questions to publish';end if;
-- Replace links and settings atomically; subject validation sees no stale pool.
if reviewer is not null then perform 1 from public.reviewers where id=reviewer for update;delete from public.reviewer_questions where reviewer_id=reviewer;end if;
insert into public.reviewers(id,subject_id,title,description,settings,published) values(result,subject,name,description_text,options,publish) on conflict(id) do update set subject_id=excluded.subject_id,title=excluded.title,description=excluded.description,settings=excluded.settings,published=excluded.published;
insert into public.reviewer_questions select result,x,ord::int from unnest(question_ids) with ordinality as t(x,ord);
return result;end$$;
create function public.duplicate_reviewer(source uuid) returns uuid language plpgsql security definer set search_path='' as $$declare r public.reviewers;ids uuid[];begin
if not private.is_admin() then raise exception 'Administrator required';end if;select * into strict r from public.reviewers where id=source;
select array_agg(question_id order by position) into ids from public.reviewer_questions where reviewer_id=source;
return public.save_reviewer(null,r.subject_id,r.title||' (copy)',r.description,r.settings,coalesce(ids,'{}'),false);end$$;
create function private.normalize(s text,strict boolean) returns text language sql immutable set search_path='' as $$select case when strict then coalesce(s,'') else lower(regexp_replace(trim(coalesce(s,'')),'\s+',' ','g')) end$$;
create function private.grade(q jsonb,response jsonb) returns numeric language plpgsql immutable set search_path='' as $$declare t text:=q->>'type';a jsonb;v text;i integer:=0;correct_count integer:=0;n integer;begin
if response is null or response='null'::jsonb or jsonb_array_length(response)=0 or not exists(select 1 from jsonb_array_elements_text(response)x where length(trim(x))>0) then return 0;end if;
if t='long_answer' or (t='short_answer' and jsonb_array_length(q->'accepted')=0) then return null;end if;
if t like 'mc_%' then if response @> (q->'correct') and (q->'correct') @> response then return (q->>'points')::numeric;else return 0;end if;end if;
for a in select * from jsonb_array_elements(q->'accepted') loop
v:=private.normalize(response->>i,(q->>'strict')::boolean);
if exists(select 1 from jsonb_array_elements_text(a)x where private.normalize(x,(q->>'strict')::boolean)=v) then correct_count:=correct_count+1;end if;i:=i+1;end loop;
return round((q->>'points')::numeric*correct_count/greatest(i,1),4);end$$;
create function private.require_attempt(a public.attempts) returns void language plpgsql stable security definer set search_path='' as $$begin
if a.id is null then raise exception 'Attempt not found';end if;
if not private.is_admin() and (a.student_id<>auth.uid() or not private.has_subject(a.subject_id) or not private.is_active()) then raise exception 'Access denied';end if;
if auth.uid() is null then raise exception 'Sign in required';end if;end$$;
create function public.start_attempt(reviewer uuid) returns uuid language plpgsql security definer set search_path='' as $$declare r public.reviewers;a public.attempts;payload jsonb:='[]';q jsonb;item record;n int;total numeric:=0;new_id uuid;limit_n int;begin
if not exists(select 1 from public.profiles where id=auth.uid() and role='student' and is_active) then raise exception 'Active student account required';end if;
-- Serialize concurrent starts for the same student before counting attempts.
perform 1 from public.profiles where id=auth.uid() for update;
select * into r from public.reviewers where id=reviewer for share;
if r.id is null or not r.published or not private.has_subject(r.subject_id) then raise exception 'Reviewer unavailable';end if;
select * into a from public.attempts where student_id=auth.uid() and reviewer_id=reviewer and status='in_progress';
if a.id is not null then return a.id;end if;
select count(*)::int into n from public.attempts where student_id=auth.uid() and reviewer_id=reviewer;
if r.settings->>'max_attempts' is not null and n >= (r.settings->>'max_attempts')::int then raise exception 'Attempt limit reached';end if;
limit_n:=case when r.settings->>'selection'='random' then (r.settings->>'count')::int else null end;
for item in select sel.* from (
select qb.id,qb.data,rq.position from public.reviewer_questions rq join public.questions qb on qb.id=rq.question_id where rq.reviewer_id=reviewer and qb.is_active and qb.subject_id=r.subject_id
order by case when r.settings->>'selection'='random' then random() else rq.position::float8 end limit limit_n
)sel order by case when (r.settings->>'shuffle_questions')::boolean then random() else sel.position::float8 end loop
q:=item.data||jsonb_build_object('id',item.id);
if (r.settings->>'shuffle_choices')::boolean then q:=jsonb_set(q,'{choices}',coalesce((select jsonb_agg(x order by random()) from jsonb_array_elements(q->'choices')x),'[]'));end if;
payload:=payload||jsonb_build_array(q);total:=total+(q->>'points')::numeric;end loop;
if jsonb_array_length(payload)=0 or (limit_n is not null and jsonb_array_length(payload)<limit_n) then raise exception 'Not enough active questions';end if;
insert into public.attempts(student_id,reviewer_id,subject_id,title,attempt_number,settings,snapshot,max_score) values(auth.uid(),reviewer,r.subject_id,r.title,n+1,r.settings,payload,total) returning id into new_id;return new_id;end$$;
create function public.save_response(attempt uuid,question text,answer jsonb) returns void language plpgsql security definer set search_path='' as $$declare a public.attempts;q jsonb;x text;n int;begin
select * into a from public.attempts where id=attempt for update;perform private.require_attempt(a);
if a.student_id<>auth.uid() or a.status<>'in_progress' then raise exception 'Attempt is not editable';end if;
select x into q from jsonb_array_elements(a.snapshot)x where x->>'id'=question;
if q is null then raise exception 'Question not in attempt';end if;
if (a.settings->>'instant')::boolean and a.responses ? question then
if a.responses->question=answer then return;end if;raise exception 'Answer locked after feedback';end if;
if jsonb_typeof(answer) is distinct from 'array' or length(answer::text)>100000 then raise exception 'Invalid response';end if;
if exists(select 1 from jsonb_array_elements(answer)x where jsonb_typeof(x)<>'string') then raise exception 'Response entries must be text';end if;
if q->>'type' like 'mc_%' then
if q->>'type'='mc_single' and jsonb_array_length(answer)>1 then raise exception 'Select one answer';end if;
for x in select * from jsonb_array_elements_text(answer) loop if not exists(select 1 from jsonb_array_elements(q->'choices')c where c->>'id'=x) then raise exception 'Invalid choice';end if;end loop;
select count(distinct x) into n from jsonb_array_elements_text(answer)x;if n<>jsonb_array_length(answer) then raise exception 'Duplicate choice';end if;
else
n:=case when q->>'type'='multi_blank' then jsonb_array_length(q->'accepted') else 1 end;
if jsonb_array_length(answer)>n then raise exception 'Too many text answers';end if;end if;
-- Do not lock an empty instant-feedback response.
if (a.settings->>'instant')::boolean and not exists(select 1 from jsonb_array_elements_text(answer)x where trim(x)<>'') then return;end if;
update public.attempts set responses=jsonb_set(responses,array[question],answer) where id=attempt;end$$;
create function public.submit_attempt(attempt uuid) returns void language plpgsql security definer set search_path='' as $$declare a public.attempts;q jsonb;r jsonb;g numeric;grades jsonb:='{}';total numeric:=0;pending_count int:=0;needed int;begin
select * into a from public.attempts where id=attempt for update;perform private.require_attempt(a);
if a.student_id<>auth.uid() then raise exception 'Only the student may submit';end if;
if a.status<>'in_progress' then return;end if;
for q in select * from jsonb_array_elements(a.snapshot) loop
r:=a.responses->(q->>'id');needed:=case when q->>'type'='multi_blank' then jsonb_array_length(q->'accepted') else 1 end;
if (a.settings->>'require_all')::boolean and (r is null or (select count(*) from jsonb_array_elements_text(r)x where length(trim(x))>0)<needed) then raise exception 'Answer all required questions before submitting';end if;
g:=private.grade(q,r);if g is null then pending_count:=pending_count+1;else total:=total+g;end if;
grades:=jsonb_set(grades,array[q->>'id'],jsonb_build_object('awarded',g,'pending',g is null));end loop;
update public.attempts set grades=grades,score=total,pending=pending_count,status=case when pending_count>0 then 'pending_review' else 'graded' end,submitted_at=now() where id=attempt;end$$;
create function public.get_attempt(attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.attempts;q jsonb;safe jsonb;out_questions jsonb:='[]';g jsonb;show_result boolean;show_key boolean;admin boolean:=private.is_admin();begin
select * into a from public.attempts where id=attempt;perform private.require_attempt(a);
if admin or a.status='in_progress' or (a.settings->>'allow_review')::boolean then
for q in select * from jsonb_array_elements(a.snapshot) loop
safe:=(q-'correct'-'accepted'-'strict')||jsonb_build_object('blanks',case when q->>'type'='multi_blank' then jsonb_array_length(q->'accepted') else 1 end,'response',a.responses->(q->>'id'));
show_result:=admin or a.status<>'in_progress' or ((a.settings->>'instant')::boolean and a.responses ? (q->>'id'));
if a.status='in_progress' then g:=jsonb_build_object('awarded',private.grade(q,a.responses->(q->>'id')),'pending',private.grade(q,a.responses->(q->>'id')) is null);else g:=a.grades->(q->>'id');end if;
if show_result then safe:=safe||g;else safe:=safe||jsonb_build_object('awarded',null,'pending',false);end if;
show_key:=admin or ((a.settings->>'show_correct')::boolean and show_result);
if show_key then safe:=safe||jsonb_build_object('correct',q->'correct','accepted',q->'accepted');end if;
out_questions:=out_questions||jsonb_build_array(safe);end loop;end if;
return jsonb_build_object('id',a.id,'title',a.title,'status',a.status,'started_at',a.started_at,'submitted_at',a.submitted_at,'score',a.score,'max_score',a.max_score,'pending',a.pending,'settings',a.settings,'questions',out_questions);end$$;
create function public.my_attempts(page_number integer default 0) returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select id,title,attempt_number,status,score,max_score,pending,started_at,submitted_at from public.attempts where student_id=auth.uid() and private.has_subject(subject_id) order by started_at desc limit 25 offset greatest(page_number,0)*25)t$$;
create function public.grade_response(attempt uuid,question text,points numeric,notes text) returns void language plpgsql security definer set search_path='' as $$declare a public.attempts;q jsonb;g jsonb;total numeric;p int;begin
if not private.is_admin() then raise exception 'Administrator required';end if;
select * into a from public.attempts where id=attempt for update;
if a.id is null or a.status='in_progress' then raise exception 'Submitted attempt required';end if;
select x into q from jsonb_array_elements(a.snapshot)x where x->>'id'=question;
if q is null or not(q->>'type'='long_answer' or (q->>'type'='short_answer' and jsonb_array_length(q->'accepted')=0)) then raise exception 'Only subjective responses can be manually graded';end if;
if points is null or points<0 or points>(q->>'points')::numeric then raise exception 'Score outside question range';end if;
g:=jsonb_build_object('awarded',points,'pending',false,'notes',left(notes,10000),'reviewed_by',auth.uid(),'reviewed_at',now());
insert into public.grade_audit(attempt_id,question_id,admin_id,old_grade,new_grade) values(attempt,question,auth.uid(),a.grades->question,g);
a.grades:=jsonb_set(a.grades,array[question],g);
select coalesce(sum((value->>'awarded')::numeric),0),count(*) filter(where (value->>'pending')::boolean) into total,p from jsonb_each(a.grades);
update public.attempts set grades=a.grades,score=total,pending=p,status=case when p>0 then 'pending_review' else 'graded' end where id=attempt;end$$;
-- Private storage: image reads require admin or the student's authorized attempt snapshot.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('question-images','question-images',false,5242880,array['image/png','image/jpeg','image/webp']),('branding','branding',false,2097152,array['image/png','image/jpeg','image/webp']);
create function private.can_read_image(path text) returns boolean language sql stable security definer set search_path='' as $$select private.is_admin() or exists(select 1 from public.attempts a,jsonb_array_elements(a.snapshot)q where a.student_id=auth.uid() and private.has_subject(a.subject_id) and (a.status='in_progress' or (a.settings->>'allow_review')::boolean) and q->>'image_path'=path)$$;
create policy image_admin_insert on storage.objects for insert to authenticated with check(bucket_id in ('question-images','branding') and private.is_admin());
create policy image_read on storage.objects for select to authenticated using((bucket_id='question-images' and private.can_read_image(name)) or (bucket_id='branding' and private.is_active()));
-- Images use immutable UUID paths. No DELETE or UPDATE policy: historical images remain intact.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_admin(),private.is_active(),private.has_subject(uuid),private.can_read_image(text) to authenticated;
revoke all on function public.admin_rate_limit(),public.set_display_name(text),public.save_reviewer(uuid,uuid,text,text,jsonb,uuid[],boolean),public.duplicate_reviewer(uuid),public.start_attempt(uuid),public.save_response(uuid,text,jsonb),public.submit_attempt(uuid),public.get_attempt(uuid),public.my_attempts(integer),public.grade_response(uuid,text,numeric,text) from public,anon;
grant execute on function public.admin_rate_limit(),public.set_display_name(text),public.save_reviewer(uuid,uuid,text,text,jsonb,uuid[],boolean),public.duplicate_reviewer(uuid),public.start_attempt(uuid),public.save_response(uuid,text,jsonb),public.submit_attempt(uuid),public.get_attempt(uuid),public.my_attempts(integer),public.grade_response(uuid,text,numeric,text) to authenticated;
commit;

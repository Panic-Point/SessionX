begin;
select plan(18);

-- Seed: Pat Parent (22222222-...-00b, parent@example.com) has a dev password and students Ava and Ben.

select ok(
  (select password_hash like 'pbkdf2-sha256$100000$%' from accounts where id = '22222222-0000-0000-0000-00000000000b'),
  'seed gives the parent a dev password');

select is(
  (select count(*)::int from pg_policies where tablename in ('password_tokens', 'password_failures')),
  0, 'password tables have no policies');

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.password_tokens'::regclass, 'public.password_failures'::regclass)),
  'password tables have RLS');

select throws_ok(
  $$ insert into password_tokens (token_hash, purpose, expires_at)
     values ('bad', 'register', '2030-01-01Z') $$,
  '23514', null, 'registration token needs an email');

-- New email: no account until the link is used. The token carries only the email.
insert into password_tokens (token_hash, purpose, email, expires_at)
values ('r1', 'register', 'new@example.com', '2030-01-01Z');

select is((select count(*)::int from accounts where email = 'new@example.com'), 0,
  'registration does not create the account before the link is used');

select is(
  (select a.role::text || '|' || a.name || '|' || a.password_hash
     from accounts a where a.id = complete_registration('r1', ' New Family ', 'pw-new', '2026-11-01Z')),
  'client|New Family|pw-new', 'using the link creates a client account with the name and password');

select results_eq(
  $$ select s.name from students s join accounts a on a.id = s.account_id
      where a.email = 'new@example.com' $$,
  $$ values ('New Family'::text) $$,
  'a new account gets its holder as its first student');

select is(complete_registration('r1', 'Again', 'pw-x', '2026-11-01Z'), null,
  'registration link is single use');

-- A blank name adds no student.
insert into password_tokens (token_hash, purpose, email, expires_at)
values ('r4', 'register', 'blank@example.com', '2030-01-01Z');

select is(
  (select count(*)::int from students
    where account_id = complete_registration('r4', '  ', 'pw', '2026-11-01Z')),
  0, 'a blank name adds no student');

-- No password hash: refused, and the link stays usable.
insert into password_tokens (token_hash, purpose, email, expires_at)
values ('r5', 'register', 'nopw@example.com', '2030-01-01Z');

select throws_ok(
  $$ select complete_registration('r5', 'No Password', null, '2026-11-01Z') $$,
  '22023', null, 'registration needs a password hash');

select isnt(complete_registration('r5', 'No Password', 'pw', '2026-11-01Z'), null,
  'a refused registration leaves the link usable');

-- Existing email: name, role and students are kept.
insert into password_tokens (token_hash, purpose, email, expires_at)
values ('r2', 'register', 'parent@example.com', '2030-01-01Z');

select is(complete_registration('r2', 'Impostor', 'pw-2', '2026-11-01Z'),
  '22222222-0000-0000-0000-00000000000b'::uuid,
  'registration for an existing email returns that account');

select results_eq(
  $$ select name, role::text, password_hash, (select count(*)::int from students s where s.account_id = a.id)
       from accounts a where id = '22222222-0000-0000-0000-00000000000b' $$,
  $$ values ('Pat Parent'::text, 'client'::text, 'pw-2'::text, 2) $$,
  'existing account keeps name, role and students; password replaced');

-- Expired and wrong-purpose tokens.
insert into password_tokens (token_hash, purpose, email, expires_at)
values ('r3', 'register', 'late@example.com', '2026-11-01Z');
insert into password_tokens (token_hash, purpose, account_id, expires_at)
values ('s1', 'reset', '22222222-0000-0000-0000-00000000000b', '2030-01-01Z');

select is(complete_registration('r3', 'Late', 'pw', '2026-11-01Z'), null,
  'expired registration link is refused');
select is(complete_registration('s1', 'X', 'pw', '2026-11-01Z'), null,
  'reset link cannot complete a registration');

-- Reset: sets the password, voids other tokens, clears the lockout.
insert into password_tokens (token_hash, purpose, account_id, expires_at)
values ('s2', 'reset', '22222222-0000-0000-0000-00000000000b', '2030-01-01Z');
insert into password_failures (email, failed_at)
values ('Parent@Example.com', now()), ('other@example.com', now());

select is(complete_password_reset('s1', 'pw-reset', '2026-11-01Z'),
  '22222222-0000-0000-0000-00000000000b'::uuid, 'reset link sets the password');

select results_eq(
  $$ select (select password_hash from accounts where id = '22222222-0000-0000-0000-00000000000b'),
            complete_password_reset('s2', 'pw-other', '2026-11-01Z'),
            (select count(*)::int from password_failures where email = 'parent@example.com'),
            (select count(*)::int from password_failures) $$,
  $$ values ('pw-reset'::text, null::uuid, 0, 1) $$,
  'reset voids the other reset link and clears only that email''s failures');

select ok(
  not has_function_privilege('anon', 'complete_registration(text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'complete_password_reset(text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'complete_registration(text,text,text,timestamptz)', 'execute'),
  'only service_role can complete registrations and resets');

select * from finish();
rollback;

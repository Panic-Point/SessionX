begin;
select plan(14);

-- Seed: Pat Parent (22222222-...-00b, parent@example.com) has a dev password and students Ava and Ben;
-- Studio Admin (22222222-...-00a) has no password.

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
  $$ insert into password_tokens (token_hash, purpose, email, expires_at)
     values ('bad', 'register', 'a@b.c', '2030-01-01Z') $$,
  '23514', null, 'registration token needs name and password hash');

-- New email: no account until the link is used.
insert into password_tokens (token_hash, purpose, email, name, password_hash, expires_at)
values ('r1', 'register', 'new@example.com', 'New Family', 'pw-new', '2030-01-01Z');

select is((select count(*)::int from accounts where email = 'new@example.com'), 0,
  'registration does not create the account before the link is used');

select is(
  (select a.role::text || '|' || a.name || '|' || a.password_hash
     from accounts a where a.id = complete_registration('r1', '2026-11-01Z')),
  'client|New Family|pw-new', 'using the link creates a client account with the password');

select is(complete_registration('r1', '2026-11-01Z'), null, 'registration link is single use');

-- Existing email: name, role and students are kept.
insert into password_tokens (token_hash, purpose, email, name, password_hash, expires_at)
values ('r2', 'register', 'parent@example.com', 'Impostor', 'pw-2', '2030-01-01Z');

select is(complete_registration('r2', '2026-11-01Z'), '22222222-0000-0000-0000-00000000000b'::uuid,
  'registration for an existing email returns that account');

select results_eq(
  $$ select name, role::text, password_hash, (select count(*)::int from students s where s.account_id = a.id)
       from accounts a where id = '22222222-0000-0000-0000-00000000000b' $$,
  $$ values ('Pat Parent'::text, 'client'::text, 'pw-2'::text, 2) $$,
  'existing account keeps name, role and students; password replaced');

-- Expired and wrong-purpose tokens.
insert into password_tokens (token_hash, purpose, email, name, password_hash, expires_at)
values ('r3', 'register', 'late@example.com', 'Late', 'pw', '2026-11-01Z');
insert into password_tokens (token_hash, purpose, account_id, expires_at)
values ('s1', 'reset', '22222222-0000-0000-0000-00000000000b', '2030-01-01Z');

select is(complete_registration('r3', '2026-11-01Z'), null, 'expired registration link is refused');
select is(complete_registration('s1', '2026-11-01Z'), null, 'reset link cannot complete a registration');

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
  not has_function_privilege('anon', 'complete_registration(text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'complete_password_reset(text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'complete_registration(text,timestamptz)', 'execute'),
  'only service_role can complete registrations and resets');

select * from finish();
rollback;

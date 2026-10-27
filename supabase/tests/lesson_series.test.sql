begin;
select plan(12);

-- Seed: Ben (b1) has a custom 3000 price on the 30-min lesson (3500 list), and a seeded weekly
-- series (44444444-...-0b1). Tuesdays at 3pm New York; clocks change on 2030-03-10.

create temp table created as
select create_lesson_series(
  '33333333-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000030',
  2::smallint, '15:00', 1::smallint, '2030-03-05', null, 3, 'note',
  array['2030-03-05 20:00Z', '2030-03-12 19:00Z', '2030-03-19 19:00Z']::timestamptz[],
  '2030-03-19', '2030-01-01 12:00Z') as r;

create temp table s as select (r->>'series_id')::uuid as id from created;

select is(jsonb_array_length((select r->'occurrences' from created)), 3, 'returns every requested start');

select results_eq(
  $$ select status::text, price_cents from bookings where series_id = (select id from s) order by starts_at $$,
  $$ values ('approved'::text, 3000), ('approved', 3000), ('approved', 3000) $$,
  'occurrences are approved at the student''s custom price');

select is(
  (select materialized_through from lesson_series where id = (select id from s)),
  '2030-03-19'::date, 'materialized_through set');

-- A clashing start is skipped, not fatal.
select lives_ok(
  $$ select request_account_booking('22222222-0000-0000-0000-00000000000b',
       '33333333-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000060', '2030-03-26 18:30Z', '') $$,
  'family books a slot');

select results_eq(
  $$ select booking_id is null from create_series_occurrences((select id from s),
       array['2030-03-26 19:00Z', '2030-04-02 19:00Z']::timestamptz[], '2030-04-02', '2030-01-01 12:00Z')
     order by starts_at $$,
  $$ values (true), (false) $$,
  'clashing occurrence skipped, the next one created');

select is(
  (select status::text from bookings where starts_at = '2030-03-26 18:30Z'),
  'pending', 'existing booking untouched');

select throws_ok(
  $$ select create_lesson_series('33333333-0000-0000-0000-0000000000ff', '11111111-0000-0000-0000-000000000030',
       2::smallint, '15:00', 1::smallint, '2030-03-05', null, 3, '', '{}'::timestamptz[], '2030-03-05', now()) $$,
  'P0003', 'student_not_found', 'unknown student raises P0003');

-- End from before the series, after the first lesson: only later live lessons are cancelled.
select is(
  (select count(*)::int from end_series((select id from s), '2030-03-01 00:00Z', '2030-03-05 21:00Z')),
  3, 'end_series returns the cancelled lessons');

select results_eq(
  $$ select status::text, late_cancel from bookings where series_id = (select id from s) order by starts_at $$,
  $$ values ('approved'::text, false), ('cancelled', false), ('cancelled', false), ('cancelled', false) $$,
  'past lesson kept, later ones cancelled, never late');

select throws_ok(
  $$ select * from create_series_occurrences((select id from s),
       array['2030-04-09 19:00Z']::timestamptz[], '2030-04-09', '2030-01-01 12:00Z') $$,
  'P0007', 'series_ended', 'an ended series gets no more occurrences');

select throws_ok(
  $$ select * from end_series('44444444-0000-0000-0000-0000000000ff', now(), now()) $$,
  'P0006', 'series_not_found', 'unknown series raises P0006');

select ok(
  not has_function_privilege('anon', 'create_series_occurrences(uuid,timestamptz[],date,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'create_lesson_series(uuid,uuid,smallint,time,smallint,date,date,integer,text,timestamptz[],date,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'end_series(uuid,timestamptz,timestamptz)', 'execute'),
  'anon cannot execute the series functions');

select * from finish();
rollback;

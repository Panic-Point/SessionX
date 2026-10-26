begin;
select plan(13);

-- Seed: Pat Parent (22222222-...-00b) with Ava (a1) and Ben (b1); Ben has a custom 3000 price on the 30-min lesson (3500 list).

select throws_ok(
  $$ insert into students (account_id, name) values ('22222222-0000-0000-0000-00000000000b', '  aVA ') $$,
  '23505', null, 'duplicate student name in same account rejected');

insert into accounts (id, name, email) values ('22222222-0000-0000-0000-0000000000c1', 'Other', 'other@example.com');

select lives_ok(
  $$ insert into students (account_id, name) values ('22222222-0000-0000-0000-0000000000c1', 'Ava') $$,
  'same name in different accounts allowed');

select is(
  (select price_cents from request_account_booking('22222222-0000-0000-0000-00000000000b',
    '33333333-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000030', '2030-02-04 15:00Z', '')),
  3000, 'account booking uses custom price');

select is(
  (select price_cents from request_account_booking('22222222-0000-0000-0000-00000000000b',
    '33333333-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000030', '2030-02-05 15:00Z', '')),
  3500, 'account booking uses list price without custom');

select throws_ok(
  $$ select request_account_booking('22222222-0000-0000-0000-00000000000b',
       '33333333-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000030', '2030-02-06 15:00Z', '') $$,
  'P0001', 'too_many_pending', 'account booking pending limit');

select throws_ok(
  $$ select request_account_booking('22222222-0000-0000-0000-0000000000c1',
       '33333333-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000030', '2030-03-01 15:00Z', '') $$,
  'P0003', 'student_not_found', 'student from another account raises P0003');

select throws_ok(
  $$ select request_account_booking('22222222-0000-0000-0000-0000000000c1',
       (select id from students where name = 'Ava' and account_id = '22222222-0000-0000-0000-0000000000c1'),
       '11111111-0000-0000-0000-000000000060', '2030-02-04 15:15Z', '') $$,
  '23P01', null, 'account booking overlap');

-- Cancel by owning account: late flag recorded, slot freed.
select is(
  cancel_booking(
    (select id from bookings where starts_at = '2030-02-04 15:00Z'),
    '22222222-0000-0000-0000-00000000000b', null, true, '2030-02-03 12:00Z'),
  (select id from bookings where starts_at = '2030-02-04 15:00Z'),
  'cancel by account returns booking id');

select results_eq(
  $$ select status::text, late_cancel from bookings where starts_at = '2030-02-04 15:00Z' $$,
  $$ values ('cancelled'::text, true) $$,
  'cancel by account sets status and late_cancel');

select throws_ok(
  $$ select cancel_booking((select id from bookings where starts_at = '2030-02-05 15:00Z'),
       '22222222-0000-0000-0000-0000000000c1', null, false, '2030-02-03 12:00Z') $$,
  'P0004', 'booking_not_found', 'cancel another account''s booking raises P0004');

select is(
  cancel_booking(null, null,
    (select manage_token from bookings where starts_at = '2030-02-05 15:00Z'), false, '2030-02-03 12:00Z'),
  (select id from bookings where starts_at = '2030-02-05 15:00Z'),
  'cancel by manage token');

select throws_ok(
  $$ select cancel_booking((select id from bookings where starts_at = '2030-02-05 15:00Z'),
       '22222222-0000-0000-0000-00000000000b', null, false, '2030-02-03 13:00Z') $$,
  'P0005', 'not_cancellable', 'cancel already-cancelled raises P0005');

select ok(
  not has_function_privilege('anon', 'request_account_booking(uuid,uuid,uuid,timestamptz,text)', 'execute')
  and not has_function_privilege('anon', 'cancel_booking(uuid,uuid,text,boolean,timestamptz)', 'execute'),
  'anon cannot execute either function');

select * from finish();
rollback;

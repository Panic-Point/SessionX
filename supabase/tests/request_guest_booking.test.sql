begin;
select plan(11);

-- Seed data provides: Pat Parent (parent@example.com) with students Ava and Ben,
-- lesson types 30/45/60 min (3500/5000/6500), Ben has a custom 3000 price for the 30-min lesson.

select is(
  (select price_cents from request_guest_booking(
    '  New.Guest@Example.com ', 'New Guest', 'Kid',
    '11111111-0000-0000-0000-000000000060', '2030-02-04 15:00Z', 'hello')),
  6500,
  'creates account, student and pending booking: returns list price'
);

select results_eq(
  $$ select a.email::text, a.name, s.name, b.status::text, b.note, b.ends_at, b.blocked_until
       from bookings b join students s on s.id = b.student_id join accounts a on a.id = s.account_id
      where a.email = 'new.guest@example.com' $$,
  $$ values ('new.guest@example.com'::text, 'New Guest'::text, 'Kid'::text, 'pending'::text, 'hello'::text,
             '2030-02-04 16:00Z'::timestamptz, '2030-02-04 16:00Z'::timestamptz) $$,
  'new account, student and pending booking were stored'
);

select request_guest_booking(
  'PARENT@example.com', 'Someone Else', 'Ava',
  '11111111-0000-0000-0000-000000000060', '2030-02-05 15:00Z', '');

select is(
  (select count(*)::int from accounts where email = 'parent@example.com'),
  1,
  'reuses account by email case-insensitively'
);

select is(
  (select name from accounts where email = 'parent@example.com'),
  'Pat Parent',
  'keeps the original account name'
);

select request_guest_booking(
  'parent@example.com', 'Pat Parent', '  aVa ',
  '11111111-0000-0000-0000-000000000060', '2030-02-06 15:00Z', '');

select is(
  (select count(*)::int from students where account_id = '22222222-0000-0000-0000-00000000000b'),
  2,
  'reuses student by name case-insensitively'
);

select is(
  (select price_cents from request_guest_booking(
    'other@example.com', 'Other', 'Ben',
    '11111111-0000-0000-0000-000000000030', '2030-02-07 15:00Z', '')),
  3500,
  'uses list price even when student has a custom price'
);

-- other@example.com now has 1 pending; add a second, then the third must fail.
select request_guest_booking(
  'other@example.com', 'Other', 'Ben',
  '11111111-0000-0000-0000-000000000030', '2030-02-08 15:00Z', '');

select throws_ok(
  $$ select request_guest_booking('other@example.com', 'Other', 'Ben',
       '11111111-0000-0000-0000-000000000030', '2030-02-09 15:00Z', '') $$,
  'P0001',
  'too_many_pending',
  'third pending request raises too_many_pending'
);

select throws_ok(
  $$ select request_guest_booking('fresh@example.com', 'Fresh', 'Kid',
       '99999999-0000-0000-0000-000000000000', '2030-03-04 15:00Z', '') $$,
  'P0002',
  'lesson_type_not_found',
  'unknown lesson type raises P0002'
);

update lesson_types set active = false where id = '11111111-0000-0000-0000-000000000045';

select throws_ok(
  $$ select request_guest_booking('fresh@example.com', 'Fresh', 'Kid',
       '11111111-0000-0000-0000-000000000045', '2030-03-04 15:00Z', '') $$,
  'P0002',
  'lesson_type_not_found',
  'inactive lesson type raises P0002'
);

select throws_ok(
  $$ select request_guest_booking('clash@example.com', 'Clash', 'Kid',
       '11111111-0000-0000-0000-000000000060', '2030-02-04 15:30Z', '') $$,
  '23P01',
  null,
  'overlapping request raises 23P01'
);

select is(
  has_function_privilege('anon', 'request_guest_booking(text,text,text,uuid,timestamptz,text)', 'execute'),
  false,
  'anon cannot execute'
);

select * from finish();
rollback;

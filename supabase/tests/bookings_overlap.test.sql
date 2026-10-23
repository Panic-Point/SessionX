begin;
select plan(4);

-- Fixture: one account, one student, one lesson type.
insert into accounts (id, name, email) values ('00000000-0000-0000-0000-0000000000a1', 'Test Parent', 'overlap@test.local');
insert into students (id, account_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Kid');
insert into lesson_types (id, name, duration_min, price_cents) values ('00000000-0000-0000-0000-0000000000c1', 'Test 60', 60, 6500);

insert into bookings (id, student_id, lesson_type_id, starts_at, ends_at, blocked_until, status, price_cents)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1',
        '2030-01-07 15:00Z', '2030-01-07 16:00Z', '2030-01-07 16:00Z', 'approved', 6500);

select throws_ok(
  $$ insert into bookings (student_id, lesson_type_id, starts_at, ends_at, blocked_until, status, price_cents)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1',
             '2030-01-07 15:30Z', '2030-01-07 16:30Z', '2030-01-07 16:30Z', 'pending', 6500) $$,
  '23P01',
  null,
  'overlapping pending request is rejected'
);

select lives_ok(
  $$ insert into bookings (student_id, lesson_type_id, starts_at, ends_at, blocked_until, status, price_cents)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1',
             '2030-01-07 16:00Z', '2030-01-07 17:00Z', '2030-01-07 17:00Z', 'pending', 6500) $$,
  'back-to-back booking is allowed'
);

update bookings set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000000d1';

select lives_ok(
  $$ insert into bookings (student_id, lesson_type_id, starts_at, ends_at, blocked_until, status, price_cents)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1',
             '2030-01-07 15:00Z', '2030-01-07 16:00Z', '2030-01-07 16:00Z', 'pending', 6500) $$,
  'a cancelled booking frees its slot'
);

select throws_ok(
  $$ insert into bookings (student_id, lesson_type_id, starts_at, ends_at, blocked_until, status, price_cents)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1',
             '2030-01-08 15:00Z', '2030-01-08 15:00Z', '2030-01-08 15:00Z', 'pending', 6500) $$,
  '23514',
  null,
  'zero-length booking is rejected'
);

select * from finish();
rollback;

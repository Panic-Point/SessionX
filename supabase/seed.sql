-- Local development seed data. Loaded by `npm run local:reset` (supabase db reset).

insert into settings (
	timezone, min_notice_hours, max_advance_days, cancel_cutoff_hours, allow_same_day,
	cancellation_policy_text, admin_email
) values (
	'America/New_York', 24, 60, 24, false,
	'Please cancel at least 24 hours before your lesson. Late cancellations may still be charged.',
	'admin@sessionx.local'
);

-- Monday-Friday 3pm-8pm, Saturday 9am-1pm.
insert into weekly_hours (weekday, start_time, end_time)
select d, time '15:00', time '20:00' from generate_series(1, 5) as d
union all
select 6, time '09:00', time '13:00';

insert into lesson_types (id, name, description, duration_min, price_cents, sort_order) values
	('11111111-0000-0000-0000-000000000030', '30-minute lesson', 'Great for beginners and younger students.', 30, 3500, 1),
	('11111111-0000-0000-0000-000000000045', '45-minute lesson', 'Our most popular lesson length.', 45, 5000, 2),
	('11111111-0000-0000-0000-000000000060', '60-minute lesson', 'For intermediate and advanced students.', 60, 6500, 3);

insert into accounts (id, name, email, role) values
	('22222222-0000-0000-0000-00000000000a', 'Studio Admin', 'admin@sessionx.local', 'admin'),
	('22222222-0000-0000-0000-00000000000b', 'Pat Parent', 'parent@example.com', 'client');

-- Dev password for parent@example.com: sessionx-parent-dev (see docs/local-dev.md).
update accounts
   set password_hash = 'pbkdf2-sha256$100000$Gdn8ZFyVGVjo3_9Mvebwbg$yIhLzGXbDC1e7kTUeENArJ5AllBcXi8dKeKzYRg4V1o',
       email_verified_at = now()
 where id = '22222222-0000-0000-0000-00000000000b';

insert into students (id, account_id, name) values
	('33333333-0000-0000-0000-0000000000a1', '22222222-0000-0000-0000-00000000000b', 'Ava'),
	('33333333-0000-0000-0000-0000000000b1', '22222222-0000-0000-0000-00000000000b', 'Ben');

-- Ben pays $30 instead of $35 for 30-minute lessons.
insert into student_prices (student_id, lesson_type_id, price_cents) values
	('33333333-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000030', 3000);

-- Ben's standing weekly lesson: Tuesdays at 4:00pm, no end date, at his custom price.
insert into lesson_series (
	id, student_id, lesson_type_id, weekday, start_time, interval_weeks, starts_on, price_cents
) values (
	'44444444-0000-0000-0000-0000000000b1', '33333333-0000-0000-0000-0000000000b1',
	'11111111-0000-0000-0000-000000000030', 2, time '16:00', 1, date '2026-11-03', 3000
);

-- Its occurrences for the next 12 weeks (the app's daily top-up keeps extending them).
select count(*) from create_series_occurrences(
	'44444444-0000-0000-0000-0000000000b1',
	array(
		select (d::date + time '16:00') at time zone 'America/New_York'
		  from generate_series(greatest(current_date, date '2026-11-03'), current_date + 84, interval '1 day') as d
		 where extract(isodow from d) = 2
	),
	current_date + 84,
	now()
);

-- Recurring lessons set up by the admin. A series row holds the rule; every occurrence is an
-- ordinary approved booking with series_id set, so pricing, paid tracking, cancellation and the
-- overlap guard all work unchanged. The server expands the rule into UTC start times (DST-safe in
-- settings.timezone) and passes them in; these functions only insert and cancel.
-- Called only by the SvelteKit server with the service-role key.

create table lesson_series (
	id uuid primary key default gen_random_uuid(),
	student_id uuid not null references students (id) on delete restrict,
	lesson_type_id uuid not null references lesson_types (id) on delete restrict,
	-- ISO: 1 = Monday ... 7 = Sunday.
	weekday smallint not null check (weekday between 1 and 7),
	-- Studio local time (settings.timezone).
	start_time time not null,
	interval_weeks smallint not null check (interval_weeks in (1, 2)),
	starts_on date not null,
	ends_on date,
	occurrence_count integer check (occurrence_count > 0),
	-- Price per lesson, snapshotted like an account booking (custom price, else list price).
	price_cents integer not null check (price_cents >= 0),
	note text not null default '',
	-- Last date whose occurrence has been created or skipped; the daily top-up continues after it.
	materialized_through date,
	created_at timestamptz not null default now(),
	ended_at timestamptz,
	check (ends_on is null or occurrence_count is null),
	check (ends_on is null or ends_on >= starts_on)
);

create index lesson_series_student_id_idx on lesson_series (student_id);

alter table bookings add column series_id uuid references lesson_series (id) on delete restrict;

create index bookings_series_id_idx on bookings (series_id, starts_at);

alter table lesson_series enable row level security;

-- Insert approved occurrences for a live series. A start that overlaps a live booking (23P01) or
-- is not after p_now is skipped, not fatal: its row comes back with a null booking_id.
-- materialized_through moves forward to p_through.
create function create_series_occurrences(
	p_series_id uuid,
	p_starts_at timestamptz[],
	p_through date,
	p_now timestamptz
)
returns table (starts_at timestamptz, booking_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
	v_series lesson_series%rowtype;
	v_duration_min integer;
	v_buffer_min integer;
	v_start timestamptz;
	v_id uuid;
begin
	select * into v_series from lesson_series ls where ls.id = p_series_id for update;
	if not found then
		raise exception 'series_not_found' using errcode = 'P0006';
	end if;
	if v_series.ended_at is not null then
		raise exception 'series_ended' using errcode = 'P0007';
	end if;

	select lt.duration_min into v_duration_min from lesson_types lt where lt.id = v_series.lesson_type_id;
	select st.buffer_min into v_buffer_min from settings st;

	foreach v_start in array coalesce(p_starts_at, '{}'::timestamptz[]) loop
		v_id := null;
		if v_start > p_now then
			begin
				insert into bookings (
					student_id, lesson_type_id, starts_at, ends_at, blocked_until, status,
					price_cents, note, series_id, decided_at
				)
				values (
					v_series.student_id, v_series.lesson_type_id, v_start,
					v_start + make_interval(mins => v_duration_min),
					v_start + make_interval(mins => v_duration_min + coalesce(v_buffer_min, 0)),
					'approved', v_series.price_cents, v_series.note, p_series_id, p_now
				)
				returning bookings.id into v_id;
			exception when exclusion_violation then
				v_id := null;
			end;
		end if;
		starts_at := v_start;
		booking_id := v_id;
		return next;
	end loop;

	update lesson_series ls
	   set materialized_through = greatest(coalesce(ls.materialized_through, p_through), p_through)
	 where ls.id = p_series_id;
end;
$$;

-- Create a series and its first occurrences in one transaction.
-- Returns {"series_id": uuid, "occurrences": [{"starts_at": ..., "booking_id": uuid | null}]}.
create function create_lesson_series(
	p_student_id uuid,
	p_lesson_type_id uuid,
	p_weekday smallint,
	p_start_time time,
	p_interval_weeks smallint,
	p_starts_on date,
	p_ends_on date,
	p_occurrence_count integer,
	p_note text,
	p_starts_at timestamptz[],
	p_through date,
	p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_price integer;
	v_series_id uuid;
	v_occurrences jsonb;
begin
	perform 1 from students s where s.id = p_student_id;
	if not found then
		raise exception 'student_not_found' using errcode = 'P0003';
	end if;

	select coalesce(sp.price_cents, lt.price_cents)
	  into v_price
	  from lesson_types lt
	  left join student_prices sp on sp.lesson_type_id = lt.id and sp.student_id = p_student_id
	 where lt.id = p_lesson_type_id and lt.active;
	if not found then
		raise exception 'lesson_type_not_found' using errcode = 'P0002';
	end if;

	insert into lesson_series (
		student_id, lesson_type_id, weekday, start_time, interval_weeks, starts_on, ends_on,
		occurrence_count, price_cents, note
	)
	values (
		p_student_id, p_lesson_type_id, p_weekday, p_start_time, p_interval_weeks, p_starts_on,
		p_ends_on, p_occurrence_count, v_price, coalesce(p_note, '')
	)
	returning id into v_series_id;

	select coalesce(
		jsonb_agg(jsonb_build_object('starts_at', o.starts_at, 'booking_id', o.booking_id) order by o.starts_at),
		'[]'::jsonb
	)
	  into v_occurrences
	  from create_series_occurrences(v_series_id, p_starts_at, p_through, p_now) o;

	return jsonb_build_object('series_id', v_series_id, 'occurrences', v_occurrences);
end;
$$;

-- End a series: cancel its live occurrences starting at or after p_from (never past ones), and
-- stop top-ups. Admin cancellations are never late. Returns the cancelled booking ids.
create function end_series(p_series_id uuid, p_from timestamptz, p_now timestamptz)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
begin
	perform 1 from lesson_series ls where ls.id = p_series_id for update;
	if not found then
		raise exception 'series_not_found' using errcode = 'P0006';
	end if;

	update lesson_series ls set ended_at = coalesce(ls.ended_at, p_now) where ls.id = p_series_id;

	return query
	update bookings b
	   set status = 'cancelled', cancelled_at = p_now, late_cancel = false
	 where b.series_id = p_series_id
	   and b.status in ('pending', 'approved')
	   and b.starts_at >= p_from
	   and b.starts_at > p_now
	returning b.id;
end;
$$;

revoke execute on function create_series_occurrences(uuid, timestamptz[], date, timestamptz)
	from public, anon, authenticated;
grant execute on function create_series_occurrences(uuid, timestamptz[], date, timestamptz)
	to service_role;

revoke execute on function create_lesson_series(uuid, uuid, smallint, time, smallint, date, date, integer, text, timestamptz[], date, timestamptz)
	from public, anon, authenticated;
grant execute on function create_lesson_series(uuid, uuid, smallint, time, smallint, date, date, integer, text, timestamptz[], date, timestamptz)
	to service_role;

revoke execute on function end_series(uuid, timestamptz, timestamptz)
	from public, anon, authenticated;
grant execute on function end_series(uuid, timestamptz, timestamptz) to service_role;

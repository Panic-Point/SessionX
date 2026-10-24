-- Atomically create a guest's pending booking request: find-or-create the account and
-- student, validate the lesson type, enforce the pending limit, and insert the booking.
-- Called only by the SvelteKit server with the service-role key.
-- Overlaps surface as SQLSTATE 23P01 from the bookings_no_overlap exclusion constraint.

create function request_guest_booking(
	p_email text,
	p_account_name text,
	p_student_name text,
	p_lesson_type_id uuid,
	p_starts_at timestamptz,
	p_note text
)
returns table (
	booking_id uuid,
	manage_token text,
	price_cents integer,
	starts_at timestamptz,
	ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
	v_email text := lower(trim(p_email));
	v_account_id uuid;
	v_student_id uuid;
	v_duration_min integer;
	v_list_price integer;
	v_buffer_min integer;
	v_ends_at timestamptz;
begin
	select lt.duration_min, lt.price_cents
	  into v_duration_min, v_list_price
	  from lesson_types lt
	 where lt.id = p_lesson_type_id and lt.active;
	if not found then
		raise exception 'lesson_type_not_found' using errcode = 'P0002';
	end if;

	-- Existing accounts keep their name; the no-op update makes the row visible under concurrency.
	insert into accounts (name, email)
	values (p_account_name, v_email)
	on conflict (email) do update set email = accounts.email
	returning id into v_account_id;

	if (select count(*)
	      from bookings b
	      join students s on s.id = b.student_id
	     where s.account_id = v_account_id
	       and b.status = 'pending'
	       and b.starts_at > now()) >= 2 then
		raise exception 'too_many_pending' using errcode = 'P0001';
	end if;

	select s.id into v_student_id
	  from students s
	 where s.account_id = v_account_id
	   and lower(trim(s.name)) = lower(trim(p_student_name))
	 order by s.created_at
	 limit 1;
	if v_student_id is null then
		insert into students (account_id, name)
		values (v_account_id, trim(p_student_name))
		returning id into v_student_id;
	end if;

	select st.buffer_min into v_buffer_min from settings st;
	v_ends_at := p_starts_at + make_interval(mins => v_duration_min);

	return query
	insert into bookings (student_id, lesson_type_id, starts_at, ends_at, blocked_until, status, price_cents, note)
	values (
		v_student_id, p_lesson_type_id, p_starts_at, v_ends_at,
		v_ends_at + make_interval(mins => coalesce(v_buffer_min, 0)),
		'pending', v_list_price, coalesce(p_note, '')
	)
	returning bookings.id, bookings.manage_token, bookings.price_cents, bookings.starts_at, bookings.ends_at;
end;
$$;

revoke execute on function request_guest_booking(text, text, text, uuid, timestamptz, text)
	from public, anon, authenticated;
grant execute on function request_guest_booking(text, text, text, uuid, timestamptz, text)
	to service_role;

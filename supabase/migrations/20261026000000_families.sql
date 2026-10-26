-- Family accounts: unique student names per account, booking for an account's own student
-- (with per-student custom prices), and cancellation by account or by manage token.
-- Called only by the SvelteKit server with the service-role key.

create unique index students_account_name_key on students (account_id, lower(btrim(name)));

create function request_account_booking(
	p_account_id uuid,
	p_student_id uuid,
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
	v_duration_min integer;
	v_price integer;
	v_buffer_min integer;
	v_ends_at timestamptz;
begin
	perform 1 from students s where s.id = p_student_id and s.account_id = p_account_id;
	if not found then
		raise exception 'student_not_found' using errcode = 'P0003';
	end if;

	select lt.duration_min, coalesce(sp.price_cents, lt.price_cents)
	  into v_duration_min, v_price
	  from lesson_types lt
	  left join student_prices sp on sp.lesson_type_id = lt.id and sp.student_id = p_student_id
	 where lt.id = p_lesson_type_id and lt.active;
	if not found then
		raise exception 'lesson_type_not_found' using errcode = 'P0002';
	end if;

	if (select count(*)
	      from bookings b
	      join students s on s.id = b.student_id
	     where s.account_id = p_account_id
	       and b.status = 'pending'
	       and b.starts_at > now()) >= 2 then
		raise exception 'too_many_pending' using errcode = 'P0001';
	end if;

	select st.buffer_min into v_buffer_min from settings st;
	v_ends_at := p_starts_at + make_interval(mins => v_duration_min);

	return query
	insert into bookings (student_id, lesson_type_id, starts_at, ends_at, blocked_until, status, price_cents, note)
	values (
		p_student_id, p_lesson_type_id, p_starts_at, v_ends_at,
		v_ends_at + make_interval(mins => coalesce(v_buffer_min, 0)),
		'pending', v_price, coalesce(p_note, '')
	)
	returning bookings.id, bookings.manage_token, bookings.price_cents, bookings.starts_at, bookings.ends_at;
end;
$$;

-- Cancel a pending/approved future booking, identified either by (booking id + owning account)
-- or by the guest manage token. Exactly one identification style must be supplied.
create function cancel_booking(
	p_booking_id uuid,
	p_account_id uuid,
	p_manage_token text,
	p_late boolean,
	p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
	v_id uuid;
	v_status booking_status;
	v_starts_at timestamptz;
begin
	if (p_booking_id is not null and p_account_id is not null) = (p_manage_token is not null) then
		raise exception 'invalid_target' using errcode = '22023';
	end if;

	select b.id, b.status, b.starts_at
	  into v_id, v_status, v_starts_at
	  from bookings b
	  join students s on s.id = b.student_id
	 where (p_booking_id is not null and b.id = p_booking_id and s.account_id = p_account_id)
	    or (p_manage_token is not null and b.manage_token = p_manage_token)
	   for update of b;
	if not found then
		raise exception 'booking_not_found' using errcode = 'P0004';
	end if;

	if v_status not in ('pending', 'approved') or v_starts_at <= p_now then
		raise exception 'not_cancellable' using errcode = 'P0005';
	end if;

	update bookings b
	   set status = 'cancelled', cancelled_at = p_now, late_cancel = coalesce(p_late, false)
	 where b.id = v_id;

	return v_id;
end;
$$;

revoke execute on function request_account_booking(uuid, uuid, uuid, timestamptz, text)
	from public, anon, authenticated;
grant execute on function request_account_booking(uuid, uuid, uuid, timestamptz, text)
	to service_role;

revoke execute on function cancel_booking(uuid, uuid, text, boolean, timestamptz)
	from public, anon, authenticated;
grant execute on function cancel_booking(uuid, uuid, text, boolean, timestamptz)
	to service_role;

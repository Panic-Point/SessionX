-- Admin area: magic-link sign-in tokens and transactional schedule editors.
-- Called only by the SvelteKit server with the service-role key.

-- Single-use sign-in tokens. Only the hash is stored; the raw token lives in the emailed link.
create table login_tokens (
	token_hash text primary key,
	account_id uuid not null references accounts (id) on delete cascade,
	expires_at timestamptz not null,
	used_at timestamptz,
	created_at timestamptz not null default now()
);

alter table login_tokens enable row level security;

-- Replace the whole weekly schedule in one transaction.
-- p_hours: [{"weekday":1,"start":"15:00","end":"20:00"}, ...]
-- A bad row (end <= start) raises 23514 and the delete is rolled back with the call.
create function replace_weekly_hours(p_hours jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	delete from weekly_hours;

	insert into weekly_hours (weekday, start_time, end_time)
	select (r->>'weekday')::smallint, (r->>'start')::time, (r->>'end')::time
	  from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) as r;
end;
$$;

-- Upsert a date override and replace that date's ranges.
-- p_ranges: [{"start":"10:00","end":"12:00"}]; ignored (cleared) when p_is_closed.
create function save_date_override(
	p_date date,
	p_is_closed boolean,
	p_note text,
	p_ranges jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into date_overrides (date, is_closed, note)
	values (p_date, p_is_closed, p_note)
	on conflict (date) do update
		set is_closed = excluded.is_closed, note = excluded.note;

	delete from date_override_ranges where date = p_date;

	if not p_is_closed then
		insert into date_override_ranges (date, start_time, end_time)
		select p_date, (r->>'start')::time, (r->>'end')::time
		  from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) as r;
	end if;
end;
$$;

revoke execute on function replace_weekly_hours(jsonb) from public, anon, authenticated;
grant execute on function replace_weekly_hours(jsonb) to service_role;

revoke execute on function save_date_override(date, boolean, text, jsonb)
	from public, anon, authenticated;
grant execute on function save_date_override(date, boolean, text, jsonb) to service_role;

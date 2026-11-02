-- First-party usage telemetry for the admin Usage tab: page views with time on page, sign-ins and
-- server errors. Nothing identifying is stored for guests: a visit id is a random value the
-- browser keeps for one tab session, and no IP address, user agent, email or full URL is kept.
-- Pages are stored by route id (e.g. /manage/[token]), so manage-link tokens never land here.
-- Admin activity is not recorded. Rows older than 400 days are deleted by the cron job.
-- Called only by the SvelteKit server with the service-role key.

create table if not exists usage_events (
	id bigint generated always as identity primary key,
	occurred_at timestamptz not null default now(),
	kind text not null
		check (kind in ('page_view', 'page_time', 'sign_in', 'sign_in_failed', 'error')),
	-- A deleted account's activity goes with it: see usage_events_forget_account below.
	account_id uuid references accounts (id) on delete cascade,
	visit_id text check (visit_id is null or char_length(visit_id) between 8 and 64),
	route text check (route is null or char_length(route) <= 120),
	duration_ms integer check (duration_ms is null or duration_ms between 0 and 1800000),
	detail text check (detail is null or char_length(detail) <= 200)
);

create index if not exists usage_events_occurred_at on usage_events (occurred_at);

alter table usage_events enable row level security;

grant select, insert, delete on usage_events to service_role;

-- delete_account keeps the account row (soft delete), so forget its activity when deleted_at is set.
create or replace function usage_events_forget_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	delete from usage_events where account_id = new.id;
	return new;
end;
$$;

revoke execute on function usage_events_forget_account() from public, anon, authenticated;

drop trigger if exists usage_events_forget_account on accounts;
create trigger usage_events_forget_account
	after update of deleted_at on accounts
	for each row
	when (old.deleted_at is null and new.deleted_at is not null)
	execute function usage_events_forget_account();

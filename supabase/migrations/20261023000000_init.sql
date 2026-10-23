-- SessionX initial schema.
-- All access goes through the SvelteKit server with the service-role key, so RLS is
-- enabled everywhere with no policies: anon/authenticated clients can read nothing.

create extension if not exists btree_gist;
create extension if not exists citext;

create type account_role as enum ('client', 'admin');
create type booking_status as enum ('pending', 'approved', 'declined', 'cancelled', 'expired');

-- Studio-wide settings. Exactly one row (id is always true).
create table settings (
	id boolean primary key default true check (id),
	timezone text not null default 'America/New_York',
	min_notice_hours integer not null default 24 check (min_notice_hours >= 0),
	max_advance_days integer not null default 60 check (max_advance_days > 0),
	slot_increment_min integer not null default 30 check (slot_increment_min > 0),
	buffer_min integer not null default 0 check (buffer_min >= 0),
	allow_same_day boolean not null default false,
	cancel_cutoff_hours integer not null default 24 check (cancel_cutoff_hours >= 0),
	cancellation_policy_text text not null default '',
	admin_email citext,
	gcal_write_calendar_id text,
	gcal_busy_calendar_ids text[] not null default '{}',
	updated_at timestamptz not null default now()
);

-- Recurring weekly opening hours. weekday is ISO: 1 = Monday ... 7 = Sunday.
create table weekly_hours (
	id uuid primary key default gen_random_uuid(),
	weekday smallint not null check (weekday between 1 and 7),
	start_time time not null,
	end_time time not null,
	check (end_time > start_time)
);

-- One-off changes for a specific date. Closed, or open only during its ranges.
create table date_overrides (
	date date primary key,
	is_closed boolean not null default false,
	note text
);

create table date_override_ranges (
	id uuid primary key default gen_random_uuid(),
	date date not null references date_overrides (date) on delete cascade,
	start_time time not null,
	end_time time not null,
	check (end_time > start_time)
);

create table lesson_types (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	description text not null default '',
	duration_min integer not null check (duration_min > 0),
	price_cents integer not null check (price_cents >= 0),
	active boolean not null default true,
	sort_order integer not null default 0,
	created_at timestamptz not null default now()
);

-- The person who books (usually a parent). Identified by email; signing in is optional.
create table accounts (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	email citext not null unique,
	phone text,
	auth_user_id uuid unique references auth.users (id) on delete set null,
	role account_role not null default 'client',
	admin_notes text not null default '',
	created_at timestamptz not null default now()
);

-- Who the lesson is for. An account can have several students (e.g. siblings).
create table students (
	id uuid primary key default gen_random_uuid(),
	account_id uuid not null references accounts (id) on delete cascade,
	name text not null,
	notes text not null default '',
	created_at timestamptz not null default now()
);

create index students_account_id_idx on students (account_id);

-- Custom per-student price for a lesson type. Admin-managed.
create table student_prices (
	student_id uuid not null references students (id) on delete cascade,
	lesson_type_id uuid not null references lesson_types (id) on delete cascade,
	price_cents integer not null check (price_cents >= 0),
	primary key (student_id, lesson_type_id)
);

create table bookings (
	id uuid primary key default gen_random_uuid(),
	student_id uuid not null references students (id) on delete restrict,
	lesson_type_id uuid not null references lesson_types (id) on delete restrict,
	starts_at timestamptz not null,
	ends_at timestamptz not null,
	-- ends_at + settings.buffer_min at the time of booking; the overlap guard uses this.
	blocked_until timestamptz not null,
	status booking_status not null default 'pending',
	late_cancel boolean not null default false,
	-- Price the teacher will charge, snapshotted at booking time.
	price_cents integer not null check (price_cents >= 0),
	paid_at timestamptz,
	gcal_event_id text,
	note text not null default '',
	decline_reason text,
	-- Secret for the guest "manage / cancel" email link.
	manage_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
	created_at timestamptz not null default now(),
	decided_at timestamptz,
	cancelled_at timestamptz,
	check (ends_at > starts_at),
	check (blocked_until >= ends_at),
	-- No two live (pending or approved) bookings may overlap, even under concurrent inserts.
	constraint bookings_no_overlap exclude using gist (
		tstzrange(starts_at, blocked_until, '[)') with &&
	) where (status in ('pending', 'approved'))
);

create index bookings_status_starts_at_idx on bookings (status, starts_at);
create index bookings_student_id_idx on bookings (student_id);

alter table settings enable row level security;
alter table weekly_hours enable row level security;
alter table date_overrides enable row level security;
alter table date_override_ranges enable row level security;
alter table lesson_types enable row level security;
alter table accounts enable row level security;
alter table students enable row level security;
alter table student_prices enable row level security;
alter table bookings enable row level security;

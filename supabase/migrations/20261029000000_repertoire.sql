-- Each student's repertoire: a plain list of songs the teacher keeps (no sheet music is stored).
-- The admin edits it; the family sees it read-only on their account.
-- Safe to run twice: production migrations are applied by hand (#39).
-- Called only by the SvelteKit server with the service-role key.

create table if not exists repertoire_songs (
	id uuid primary key default gen_random_uuid(),
	student_id uuid not null references students (id) on delete cascade,
	title text not null check (btrim(title) <> ''),
	-- Composer or artist; empty when unknown.
	artist text not null default '',
	status text not null default 'learning' check (status in ('learning', 'ready', 'past')),
	notes text not null default '',
	created_at timestamptz not null default now()
);

create index if not exists repertoire_songs_student_id_idx on repertoire_songs (student_id);

alter table repertoire_songs enable row level security;

grant select, insert, update, delete on repertoire_songs to service_role;

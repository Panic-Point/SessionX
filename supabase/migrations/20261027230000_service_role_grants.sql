-- The server talks to the database only with the service-role key. Local Supabase grants
-- service_role full access to new public tables by default, but newer hosted projects do not, so
-- every table read failed there with 403 (permission denied). Grant it explicitly, including for
-- tables added by later migrations.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
	grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
	grant usage, select on sequences to service_role;

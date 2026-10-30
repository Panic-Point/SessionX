-- Session cookies are stateless, so signing out or resetting a password used to leave every other
-- cookie valid until it expired (30 days). Each cookie now carries the account's session_version
-- and the server rejects one that doesn't match. Bumping the version revokes every session.

alter table accounts add column session_version int not null default 0;

-- Any change to the password hash (reset, registration for an existing email, a signed-in
-- change, account deletion) revokes existing sessions. The server signs the current device back
-- in afterwards.
create function bump_session_version_on_password_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	if new.password_hash is distinct from old.password_hash then
		new.session_version := old.session_version + 1;
	end if;
	return new;
end;
$$;

create trigger accounts_password_change_revokes_sessions
	before update of password_hash on accounts
	for each row execute function bump_session_version_on_password_change();

-- "Sign out everywhere". Returns false for an unknown or deleted account.
-- Called only by the SvelteKit server with the service-role key.
create function revoke_sessions(p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
	update accounts
	   set session_version = session_version + 1
	 where id = p_account_id
	   and deleted_at is null;
	return found;
end;
$$;

revoke execute on function revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function revoke_sessions(uuid) to service_role;

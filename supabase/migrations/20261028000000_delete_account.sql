-- Families can delete their own account. The row stays (soft delete) because bookings reference
-- its students with on delete restrict and the teacher keeps the lesson history: the name,
-- students and bookings remain, while the email is replaced so the address is free for a fresh
-- account and the password and unused sign-in links are removed.
-- Safe to run twice: production migrations are applied by hand (#39).
-- Called only by the SvelteKit server with the service-role key, after it has cancelled the
-- account's upcoming lessons.

alter table accounts add column if not exists deleted_at timestamptz;

create or replace function delete_account(p_account_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	update accounts
	   set deleted_at = p_now,
	       email = 'deleted-' || id || '@deleted.invalid',
	       phone = null,
	       auth_user_id = null,
	       password_hash = null,
	       email_verified_at = null
	 where id = p_account_id and role = 'client' and deleted_at is null;
	if not found then
		raise exception 'account_not_found' using errcode = 'P0008';
	end if;

	delete from login_tokens where account_id = p_account_id;
	delete from password_tokens where account_id = p_account_id;
end;
$$;

revoke execute on function delete_account(uuid, timestamptz) from public, anon, authenticated;
grant execute on function delete_account(uuid, timestamptz) to service_role;

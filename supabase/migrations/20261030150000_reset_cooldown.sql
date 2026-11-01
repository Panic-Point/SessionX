-- Password-reset emails are rate limited per account (#53): a new reset token is created only when
-- the account has no unused one from after p_since. Locking the account row makes the check and
-- the insert one step, so parallel requests can't each pass the check and all send an email.
-- Safe to run twice: production migrations are applied by hand (#39).
-- Called only by the SvelteKit server with the service-role key.

create or replace function create_reset_token_unless_recent(
	p_token_hash text,
	p_account_id uuid,
	p_expires_at timestamptz,
	p_since timestamptz,
	p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
	perform 1 from accounts where id = p_account_id for update;
	if not found then
		return false;
	end if;

	if exists (
		select 1 from password_tokens
		 where account_id = p_account_id
		   and purpose = 'reset'
		   and used_at is null
		   and created_at > p_since
	) then
		return false;
	end if;

	insert into password_tokens (token_hash, purpose, account_id, expires_at, created_at)
	values (p_token_hash, 'reset', p_account_id, p_expires_at, p_now);
	return true;
end;
$$;

revoke execute on function create_reset_token_unless_recent(text, uuid, timestamptz, timestamptz, timestamptz)
	from public, anon, authenticated;
grant execute on function create_reset_token_unless_recent(text, uuid, timestamptz, timestamptz, timestamptz)
	to service_role;

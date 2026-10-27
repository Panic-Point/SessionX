-- Registration asks only for an email. The person chooses their password (and, for a new account,
-- their name) on the page the emailed link opens, so a registration token now carries just the
-- email and complete_registration takes the name and password hash. A new account also gets its
-- holder as its first student, in the same transaction.
-- Called only by the SvelteKit server with the service-role key.

-- name and password_hash may now be null for a registration. Tokens issued before this migration
-- still carry them; complete_registration ignores them.
alter table password_tokens drop constraint password_tokens_check;
alter table password_tokens add constraint password_tokens_check check (
	(purpose = 'register' and account_id is null and email is not null)
	or (purpose = 'reset' and account_id is not null and email is null
		and name is null and password_hash is null)
);

drop function complete_registration(text, timestamptz);

-- Use a registration link. Creates the account (role client) named p_name when the email has none,
-- with that name as its first student (skipped when the trimmed name is empty); an existing account
-- keeps its name, role, students and history and just gets the password. Returns the account id,
-- or null for an unknown, used or expired token.
create function complete_registration(
	p_token_hash text,
	p_name text,
	p_password_hash text,
	p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_token password_tokens;
	v_name text := nullif(btrim(coalesce(p_name, '')), '');
	v_account_id uuid;
begin
	if coalesce(p_password_hash, '') = '' then
		raise exception 'complete_registration needs a password hash' using errcode = '22023';
	end if;

	update password_tokens t
	   set used_at = p_now
	 where t.token_hash = p_token_hash
	   and t.purpose = 'register'
	   and t.used_at is null
	   and t.expires_at > p_now
	returning * into v_token;
	if not found then
		return null;
	end if;

	insert into accounts (name, email, role)
	values (coalesce(v_name, v_token.email::text), v_token.email, 'client')
	on conflict (email) do nothing
	returning id into v_account_id;

	-- Only a brand-new account: an existing family keeps the students they booked for.
	if v_account_id is not null and v_name is not null then
		insert into students (account_id, name) values (v_account_id, v_name);
	end if;

	update accounts a
	   set password_hash = p_password_hash,
	       email_verified_at = coalesce(a.email_verified_at, p_now)
	 where a.email = v_token.email
	returning a.id into v_account_id;

	perform password_link_used(v_account_id, v_token.email, p_now);
	return v_account_id;
end;
$$;

revoke execute on function complete_registration(text, text, text, timestamptz)
	from public, anon, authenticated;
grant execute on function complete_registration(text, text, text, timestamptz) to service_role;

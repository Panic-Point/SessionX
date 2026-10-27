-- Password sign-in alongside magic links. A password only takes effect once its email is
-- verified: registrations and resets are held in password_tokens until the emailed link is used.
-- Called only by the SvelteKit server with the service-role key.

alter table accounts
	add column password_hash text,
	add column email_verified_at timestamptz;

create type password_token_purpose as enum ('register', 'reset');

-- Single-use registration and reset tokens. Only the hash is stored; the raw token lives in the
-- emailed link. A registration names an email (which may or may not have an account yet) and
-- carries the pending name and password hash; a reset names an existing account.
create table password_tokens (
	token_hash text primary key,
	purpose password_token_purpose not null,
	account_id uuid references accounts (id) on delete cascade,
	email citext,
	name text,
	password_hash text,
	expires_at timestamptz not null,
	used_at timestamptz,
	created_at timestamptz not null default now(),
	check (
		(purpose = 'register' and account_id is null and email is not null
			and name is not null and password_hash is not null)
		or (purpose = 'reset' and account_id is not null and email is null
			and name is null and password_hash is null)
	)
);

alter table password_tokens enable row level security;

-- Failed password sign-ins, keyed by email (not account) so unknown emails lock out the same way
-- and a lockout never reveals whether an account exists.
create table password_failures (
	id bigint generated always as identity primary key,
	email citext not null,
	failed_at timestamptz not null
);

create index password_failures_email_idx on password_failures (email, failed_at);
create index password_failures_failed_at_idx on password_failures (failed_at);

alter table password_failures enable row level security;

-- After a password is set from an emailed link: void the account's other unused tokens and clear
-- its lockout.
create function password_link_used(p_account_id uuid, p_email citext, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	update password_tokens t
	   set used_at = p_now
	 where t.used_at is null
	   and (t.account_id = p_account_id or t.email = p_email);

	delete from password_failures f where f.email = p_email;
end;
$$;

-- Use a registration link. Creates the account (role client) when the email has none; an existing
-- account keeps its name, role and history and just gets the password. Returns the account id, or
-- null for an unknown, used or expired token.
create function complete_registration(p_token_hash text, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_token password_tokens;
	v_account_id uuid;
begin
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
	values (v_token.name, v_token.email, 'client')
	on conflict (email) do nothing;

	update accounts a
	   set password_hash = v_token.password_hash,
	       email_verified_at = coalesce(a.email_verified_at, p_now)
	 where a.email = v_token.email
	returning a.id into v_account_id;

	perform password_link_used(v_account_id, v_token.email, p_now);
	return v_account_id;
end;
$$;

-- Use a reset link: set the new password. Returns the account id, or null for an unknown, used or
-- expired token.
create function complete_password_reset(
	p_token_hash text,
	p_password_hash text,
	p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_account_id uuid;
	v_email citext;
begin
	update password_tokens t
	   set used_at = p_now
	 where t.token_hash = p_token_hash
	   and t.purpose = 'reset'
	   and t.used_at is null
	   and t.expires_at > p_now
	returning t.account_id into v_account_id;
	if not found then
		return null;
	end if;

	update accounts a
	   set password_hash = p_password_hash,
	       email_verified_at = coalesce(a.email_verified_at, p_now)
	 where a.id = v_account_id
	returning a.email into v_email;

	perform password_link_used(v_account_id, v_email, p_now);
	return v_account_id;
end;
$$;

revoke execute on function password_link_used(uuid, citext, timestamptz)
	from public, anon, authenticated, service_role;

revoke execute on function complete_registration(text, timestamptz)
	from public, anon, authenticated;
grant execute on function complete_registration(text, timestamptz) to service_role;

revoke execute on function complete_password_reset(text, text, timestamptz)
	from public, anon, authenticated;
grant execute on function complete_password_reset(text, text, timestamptz) to service_role;

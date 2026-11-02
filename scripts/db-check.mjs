// Runs the Supabase migrations + seed in PGlite (no Docker) and exercises the database rules.
// Usage: npm run test:db:lite
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(fileURLToPath(import.meta.url), '../..');
const db = new PGlite({ extensions: { btree_gist, citext } });

// Supabase provides these in real deployments; stub them here.
await db.exec(`create schema auth; create table auth.users (id uuid primary key);
  create role anon; create role authenticated; create role service_role;`);
const migDir = join(repo, 'supabase/migrations');
for (const f of readdirSync(migDir).sort()) await db.exec(readFileSync(join(migDir, f), 'utf8'));
await db.exec(readFileSync(join(repo, 'supabase/seed.sql'), 'utf8'));

const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const LESSON_60 = '11111111-0000-0000-0000-000000000060';

const results = [];

/** Run `fn` inside a transaction that is always rolled back, so checks stay independent. */
async function check(label, fn) {
	await db.exec('begin');
	try {
		await fn();
		results.push([label, 'ok']);
	} catch (e) {
		results.push([label, `FAIL (${e.code ?? ''} ${e.message})`]);
	} finally {
		await db.exec('rollback');
	}
}

function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

/** Assert that `run()` fails with SQLSTATE `code` (or succeeds when `code` is null). */
async function expectCode(run, code) {
	try {
		await run();
	} catch (e) {
		if (e.code === code) return;
		throw new Error(`wanted ${code}, got ${e.code} ${e.message}`);
	}
	if (code !== null) throw new Error(`no error, wanted ${code}`);
}

const request = (email, account, student, lesson, startsAt, note = '') =>
	db.query('select * from request_guest_booking($1, $2, $3, $4, $5, $6)', [
		email,
		account,
		student,
		lesson,
		startsAt,
		note
	]);

const requestCode = (args, code) => expectCode(() => request(...args), code);
const sqlCheck = (label, sql, code) => check(label, () => expectCode(() => db.exec(sql), code));

// ---- request_guest_booking ----
await check('creates account, student and pending booking', async () => {
	const { rows } = await request(
		'  New.Guest@Example.com ',
		'New Guest',
		'Kid',
		LESSON_60,
		'2030-02-04T15:00:00Z',
		'hello'
	);
	const r = rows[0];
	assert(rows.length === 1, 'expected one row');
	assert(r.price_cents === 6500, `price ${r.price_cents}`);
	assert(r.manage_token?.length > 10, 'manage_token missing');
	assert(new Date(r.starts_at).toISOString() === '2030-02-04T15:00:00.000Z', 'starts_at');
	assert(new Date(r.ends_at).toISOString() === '2030-02-04T16:00:00.000Z', 'ends_at');
	const { rows: b } = await db.query(
		`select b.status, b.note, b.blocked_until, a.email::text email, a.name account_name, s.name student_name
		   from bookings b join students s on s.id = b.student_id join accounts a on a.id = s.account_id
		  where b.id = $1`,
		[r.booking_id]
	);
	assert(b.length === 1, 'booking row missing');
	assert(b[0].status === 'pending', `status ${b[0].status}`);
	assert(b[0].note === 'hello', 'note');
	assert(b[0].email === 'new.guest@example.com', `email ${b[0].email}`);
	assert(b[0].account_name === 'New Guest', 'account name');
	assert(b[0].student_name === 'Kid', 'student name');
	assert(
		new Date(b[0].blocked_until).toISOString() === '2030-02-04T16:00:00.000Z',
		'blocked_until (buffer 0)'
	);
});

await check('applies settings buffer to blocked_until', async () => {
	await db.exec('update settings set buffer_min = 15');
	const { rows } = await request(
		'buf@example.com',
		'Buf',
		'Kid',
		LESSON_60,
		'2030-02-04T15:00:00Z'
	);
	const { rows: b } = await db.query('select blocked_until from bookings where id = $1', [
		rows[0].booking_id
	]);
	assert(
		new Date(b[0].blocked_until).toISOString() === '2030-02-04T16:15:00.000Z',
		`blocked_until ${b[0].blocked_until}`
	);
	assert(new Date(rows[0].ends_at).toISOString() === '2030-02-04T16:00:00.000Z', 'ends_at');
});

await check('reuses account by email case-insensitively and keeps original name', async () => {
	await request('PARENT@example.com', 'Someone Else', 'Ava', LESSON_60, '2030-02-04T15:00:00Z');
	const { rows } = await db.query(
		`select count(*)::int n, min(name) name from accounts where email = 'parent@example.com'`
	);
	assert(rows[0].n === 1, `accounts ${rows[0].n}`);
	assert(rows[0].name === 'Pat Parent', `name overwritten: ${rows[0].name}`);
});

await check('reuses student by name case-insensitively', async () => {
	await request('parent@example.com', 'Pat Parent', '  aVa ', LESSON_60, '2030-02-04T15:00:00Z');
	const { rows } = await db.query(
		`select count(*)::int n from students where account_id = '22222222-0000-0000-0000-00000000000b'`
	);
	assert(rows[0].n === 2, `students ${rows[0].n}`);
});

await check('uses list price even when student has a custom price', async () => {
	const { rows } = await request(
		'parent@example.com',
		'Pat Parent',
		'Ben',
		LESSON_30,
		'2030-02-04T15:00:00Z'
	);
	assert(rows[0].price_cents === 3500, `price ${rows[0].price_cents}`);
});

await check('third pending request raises too_many_pending (P0001)', async () => {
	await request('lim@example.com', 'Lim', 'Kid', LESSON_30, '2030-02-04T15:00:00Z');
	await request('lim@example.com', 'Lim', 'Kid', LESSON_30, '2030-02-05T15:00:00Z');
	await requestCode(
		['lim@example.com', 'Lim', 'Kid', LESSON_30, '2030-02-06T15:00:00Z', ''],
		'P0001'
	);
});

await check('inactive lesson type raises P0002', async () => {
	await db.exec(`update lesson_types set active = false where id = '${LESSON_30}'`);
	await requestCode(
		['parent@example.com', 'Pat Parent', 'Ava', LESSON_30, '2030-02-04T15:00:00Z', ''],
		'P0002'
	);
});

await check('unknown lesson type raises P0002', () =>
	requestCode(
		[
			'parent@example.com',
			'Pat Parent',
			'Ava',
			'99999999-0000-0000-0000-000000000000',
			'2030-02-04T15:00:00Z',
			''
		],
		'P0002'
	)
);

await check('overlapping request raises 23P01', async () => {
	await request('one@example.com', 'One', 'Kid', LESSON_60, '2030-02-04T15:00:00Z');
	await requestCode(
		['two@example.com', 'Two', 'Kid', LESSON_60, '2030-02-04T15:30:00Z', ''],
		'23P01'
	);
});

await check('anon cannot execute', async () => {
	const sig = 'request_guest_booking(text,text,text,uuid,timestamptz,text)';
	const { rows } = await db.query(
		`select has_function_privilege('anon', '${sig}', 'execute') anon,
		        has_function_privilege('authenticated', '${sig}', 'execute') authenticated,
		        has_function_privilege('service_role', '${sig}', 'execute') service_role`
	);
	assert(rows[0].anon === false, 'anon can execute');
	assert(rows[0].authenticated === false, 'authenticated can execute');
	assert(rows[0].service_role === true, 'service_role cannot execute');
});

// ---- bookings table rules ----
const ins = (
	s,
	e,
	status = 'pending'
) => `insert into bookings (student_id, lesson_type_id, starts_at, ends_at, blocked_until, status, price_cents)
  select s.id, l.id, '${s}', '${e}', '${e}', '${status}', 3500 from students s, lesson_types l where s.name='Ava' and l.duration_min=60`;
const approved = ins('2030-01-07 15:00Z', '2030-01-07 16:00Z', 'approved');

await sqlCheck(
	'overlap rejected',
	`${approved}; ${ins('2030-01-07 15:30Z', '2030-01-07 16:30Z')}`,
	'23P01'
);
await sqlCheck(
	'back-to-back ok',
	`${approved}; ${ins('2030-01-07 16:00Z', '2030-01-07 17:00Z')}`,
	null
);
await sqlCheck(
	'cancelled frees slot',
	`${approved}; update bookings set status='cancelled' where starts_at='2030-01-07 15:00Z'; ${ins('2030-01-07 15:00Z', '2030-01-07 16:00Z')}`,
	null
);
await sqlCheck('zero length rejected', ins('2030-01-08 15:00Z', '2030-01-08 15:00Z'), '23514');
await sqlCheck('second settings row rejected', `insert into settings (id) values (false)`, '23514');

// ---- admin: login tokens + schedule functions ----
const hoursSig = 'replace_weekly_hours(jsonb)';
const overrideSig = 'save_date_override(date,boolean,text,jsonb)';
const rangesFor = async (date) =>
	(
		await db.query(
			`select start_time::text s, end_time::text e from date_override_ranges where date = $1 order by start_time`,
			[date]
		)
	).rows.map((r) => `${r.s}-${r.e}`);
const saveOverride = (date, closed, note, ranges) =>
	db.query('select save_date_override($1, $2, $3, $4::jsonb)', [
		date,
		closed,
		note,
		JSON.stringify(ranges)
	]);

await check('login_tokens has RLS', async () => {
	const { rows } = await db.query(
		`select relrowsecurity from pg_class where oid = 'public.login_tokens'::regclass`
	);
	assert(rows[0]?.relrowsecurity === true, 'RLS not enabled on login_tokens');
	const { rows: p } = await db.query(
		`select count(*)::int n from pg_policies where tablename = 'login_tokens'`
	);
	assert(p[0].n === 0, `unexpected policies: ${p[0].n}`);
});

await check('replace_weekly_hours replaces all rows', async () => {
	const { rows: before } = await db.query('select count(*)::int n from weekly_hours');
	assert(before[0].n === 6, `seed rows ${before[0].n}`);
	await db.query('select replace_weekly_hours($1::jsonb)', [
		JSON.stringify([
			{ weekday: 2, start: '09:00', end: '12:00' },
			{ weekday: 5, start: '15:00', end: '20:00' }
		])
	]);
	const { rows } = await db.query(
		`select weekday, start_time::text s, end_time::text e from weekly_hours order by weekday`
	);
	assert(rows.length === 2, `rows ${rows.length}`);
	assert(
		rows[0].weekday === 2 && rows[0].s === '09:00:00' && rows[0].e === '12:00:00',
		'first row'
	);
	assert(
		rows[1].weekday === 5 && rows[1].s === '15:00:00' && rows[1].e === '20:00:00',
		'second row'
	);
});

await check('replace_weekly_hours rejects end <= start and keeps original rows', async () => {
	// A failed statement aborts the surrounding transaction, so use a savepoint to inspect afterwards.
	await db.exec('savepoint s');
	await expectCode(
		() =>
			db.query('select replace_weekly_hours($1::jsonb)', [
				JSON.stringify([
					{ weekday: 1, start: '10:00', end: '11:00' },
					{ weekday: 2, start: '15:00', end: '15:00' }
				])
			]),
		'23514'
	);
	await db.exec('rollback to s');
	const { rows } = await db.query('select count(*)::int n from weekly_hours');
	assert(rows[0].n === 6, `original rows lost: ${rows[0].n}`);
});

await check('save_date_override inserts closed day with no ranges', async () => {
	await saveOverride('2030-03-01', true, 'Holiday', []);
	const { rows } = await db.query(
		`select is_closed, note from date_overrides where date = '2030-03-01'`
	);
	assert(rows.length === 1, 'override row missing');
	assert(rows[0].is_closed === true && rows[0].note === 'Holiday', 'override values');
	assert((await rangesFor('2030-03-01')).length === 0, 'ranges present');
});

await check('save_date_override replaces ranges on re-save', async () => {
	await saveOverride('2030-03-02', false, 'Short day', [{ start: '10:00', end: '12:00' }]);
	assert((await rangesFor('2030-03-02')).join() === '10:00:00-12:00:00', 'first save');
	await saveOverride('2030-03-02', false, 'Other', [
		{ start: '13:00', end: '14:00' },
		{ start: '16:00', end: '18:00' }
	]);
	assert(
		(await rangesFor('2030-03-02')).join() === '13:00:00-14:00:00,16:00:00-18:00:00',
		'second save'
	);
	const { rows } = await db.query(
		`select count(*)::int n, min(note) note from date_overrides where date = '2030-03-02'`
	);
	assert(rows[0].n === 1 && rows[0].note === 'Other', 'override not upserted');
});

await check('save_date_override closed clears ranges', async () => {
	await saveOverride('2030-03-03', false, '', [{ start: '10:00', end: '12:00' }]);
	await saveOverride('2030-03-03', true, '', [{ start: '10:00', end: '12:00' }]);
	assert((await rangesFor('2030-03-03')).length === 0, 'ranges not cleared');
	const { rows } = await db.query(`select is_closed from date_overrides where date = '2030-03-03'`);
	assert(rows[0].is_closed === true, 'not closed');
});

await check('anon cannot execute either function', async () => {
	for (const sig of [hoursSig, overrideSig]) {
		const { rows } = await db.query(
			`select has_function_privilege('anon', '${sig}', 'execute') anon,
			        has_function_privilege('authenticated', '${sig}', 'execute') authenticated,
			        has_function_privilege('service_role', '${sig}', 'execute') service_role`
		);
		assert(rows[0].anon === false, `anon can execute ${sig}`);
		assert(rows[0].authenticated === false, `authenticated can execute ${sig}`);
		assert(rows[0].service_role === true, `service_role cannot execute ${sig}`);
	}
});

// ---- families: unique student names, account booking, cancellation ----
const PAT = '22222222-0000-0000-0000-00000000000b';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const BEN = '33333333-0000-0000-0000-0000000000b1';
const OTHER_ACCOUNT = '22222222-0000-0000-0000-0000000000c1';

const accountBooking = (account, student, lesson, startsAt, note = '') =>
	db.query('select * from request_account_booking($1, $2, $3, $4, $5)', [
		account,
		student,
		lesson,
		startsAt,
		note
	]);
const accountBookingCode = (args, code) => expectCode(() => accountBooking(...args), code);
const cancel = (bookingId, accountId, token, late, now) =>
	db.query('select cancel_booking($1, $2, $3, $4, $5) id', [
		bookingId,
		accountId,
		token,
		late,
		now
	]);
const addOtherAccount = () =>
	db.exec(
		`insert into accounts (id, name, email) values ('${OTHER_ACCOUNT}', 'Other', 'other@example.com');
		 insert into students (account_id, name) values ('${OTHER_ACCOUNT}', 'Zed')`
	);

await sqlCheck(
	'duplicate student name in same account rejected (23505)',
	`insert into students (account_id, name) values ('${PAT}', '  aVA ')`,
	'23505'
);
await sqlCheck(
	'same name in different accounts allowed',
	`insert into accounts (id, name, email) values ('${OTHER_ACCOUNT}', 'Other', 'other@example.com');
	 insert into students (account_id, name) values ('${OTHER_ACCOUNT}', 'Ava')`,
	null
);

await check('account booking uses custom price', async () => {
	const { rows } = await accountBooking(PAT, BEN, LESSON_30, '2030-02-04T15:00:00Z', 'hi');
	assert(rows.length === 1, 'expected one row');
	assert(rows[0].price_cents === 3000, `price ${rows[0].price_cents}`);
	assert(rows[0].manage_token?.length > 10, 'manage_token missing');
	assert(new Date(rows[0].ends_at).toISOString() === '2030-02-04T15:30:00.000Z', 'ends_at');
	const { rows: b } = await db.query(
		'select status, note, student_id from bookings where id = $1',
		[rows[0].booking_id]
	);
	assert(b[0].status === 'pending' && b[0].note === 'hi' && b[0].student_id === BEN, 'stored row');
});

await check('account booking uses list price without custom', async () => {
	const { rows } = await accountBooking(PAT, AVA, LESSON_30, '2030-02-04T15:00:00Z');
	assert(rows[0].price_cents === 3500, `price ${rows[0].price_cents}`);
});

await check('student from another account raises P0003', async () => {
	await addOtherAccount();
	await accountBookingCode([OTHER_ACCOUNT, AVA, LESSON_30, '2030-02-04T15:00:00Z'], 'P0003');
});

await check('account booking inactive lesson type raises P0002', async () => {
	await db.exec(`update lesson_types set active = false where id = '${LESSON_30}'`);
	await accountBookingCode([PAT, AVA, LESSON_30, '2030-02-04T15:00:00Z'], 'P0002');
});

await check('account booking pending limit P0001', async () => {
	await accountBooking(PAT, AVA, LESSON_30, '2030-02-04T15:00:00Z');
	await accountBooking(PAT, BEN, LESSON_30, '2030-02-05T15:00:00Z');
	await accountBookingCode([PAT, AVA, LESSON_30, '2030-02-06T15:00:00Z'], 'P0001');
});

await check('account booking overlap 23P01', async () => {
	await accountBooking(PAT, AVA, LESSON_60, '2030-02-04T15:00:00Z');
	await accountBookingCode([PAT, BEN, LESSON_30, '2030-02-04T15:30:00Z'], '23P01');
});

await check('guest booking still matches students after unique index', async () => {
	await request('parent@example.com', 'Pat Parent', ' BEN ', LESSON_60, '2030-02-04T15:00:00Z');
	const { rows } = await db.query('select count(*)::int n from students where account_id = $1', [
		PAT
	]);
	assert(rows[0].n === 2, `students ${rows[0].n}`);
});

await check('cancel by account frees slot and sets late_cancel', async () => {
	const { rows } = await accountBooking(PAT, AVA, LESSON_60, '2030-02-04T15:00:00Z');
	const id = rows[0].booking_id;
	const res = await cancel(id, PAT, null, true, '2030-02-03T12:00:00Z');
	assert(res.rows[0].id === id, 'returned id');
	const { rows: b } = await db.query(
		'select status, late_cancel, cancelled_at from bookings where id = $1',
		[id]
	);
	assert(b[0].status === 'cancelled', `status ${b[0].status}`);
	assert(b[0].late_cancel === true, 'late_cancel');
	assert(new Date(b[0].cancelled_at).toISOString() === '2030-02-03T12:00:00.000Z', 'cancelled_at');
	await accountBooking(PAT, AVA, LESSON_60, '2030-02-04T15:00:00Z');
});

await check("cancel another account's booking raises P0004", async () => {
	await addOtherAccount();
	const { rows } = await accountBooking(PAT, AVA, LESSON_60, '2030-02-04T15:00:00Z');
	await expectCode(
		() => cancel(rows[0].booking_id, OTHER_ACCOUNT, null, false, '2030-02-03T12:00:00Z'),
		'P0004'
	);
});

await check('cancel by manage token', async () => {
	const { rows } = await accountBooking(PAT, AVA, LESSON_60, '2030-02-04T15:00:00Z');
	const res = await cancel(null, null, rows[0].manage_token, false, '2030-02-03T12:00:00Z');
	assert(res.rows[0].id === rows[0].booking_id, 'returned id');
	const { rows: b } = await db.query('select status, late_cancel from bookings where id = $1', [
		rows[0].booking_id
	]);
	assert(b[0].status === 'cancelled' && b[0].late_cancel === false, 'cancelled, not late');
});

await check('cancel with unknown token raises P0004', () =>
	expectCode(() => cancel(null, null, 'nope', false, '2030-02-03T12:00:00Z'), 'P0004')
);

await check('cancel already-cancelled raises P0005', async () => {
	const { rows } = await accountBooking(PAT, AVA, LESSON_60, '2030-02-04T15:00:00Z');
	await cancel(rows[0].booking_id, PAT, null, false, '2030-02-03T12:00:00Z');
	await expectCode(
		() => cancel(rows[0].booking_id, PAT, null, false, '2030-02-03T13:00:00Z'),
		'P0005'
	);
});

await check('cancel past booking raises P0005', async () => {
	const { rows } = await accountBooking(PAT, AVA, LESSON_60, '2030-02-04T15:00:00Z');
	await expectCode(
		() => cancel(rows[0].booking_id, PAT, null, false, '2030-02-04T15:00:00Z'),
		'P0005'
	);
});

await check('anon cannot execute either function', async () => {
	for (const sig of [
		'request_account_booking(uuid,uuid,uuid,timestamptz,text)',
		'cancel_booking(uuid,uuid,text,boolean,timestamptz)'
	]) {
		const { rows } = await db.query(
			`select has_function_privilege('anon', '${sig}', 'execute') anon,
			        has_function_privilege('authenticated', '${sig}', 'execute') authenticated,
			        has_function_privilege('service_role', '${sig}', 'execute') service_role`
		);
		assert(rows[0].anon === false, `anon can execute ${sig}`);
		assert(rows[0].authenticated === false, `authenticated can execute ${sig}`);
		assert(rows[0].service_role === true, `service_role cannot execute ${sig}`);
	}
});

// ---- passwords: registration and reset tokens, failure tracking ----
const PARENT = '22222222-0000-0000-0000-00000000000b';
const ADMIN = '22222222-0000-0000-0000-00000000000a';
const addRegistration = (hash, email, expires = '2030-01-01Z') =>
	db.query(
		`insert into password_tokens (token_hash, purpose, email, expires_at)
		 values ($1, 'register', $2, $3)`,
		[hash, email, expires]
	);
const addReset = (hash, accountId, expires = '2030-01-01Z') =>
	db.query(
		`insert into password_tokens (token_hash, purpose, account_id, expires_at)
		 values ($1, 'reset', $2, $3)`,
		[hash, accountId, expires]
	);
const completeRegistration = async (hash, name, pw, now = '2026-11-01Z') =>
	(await db.query('select complete_registration($1, $2, $3, $4) id', [hash, name, pw, now])).rows[0]
		.id;
const studentsOf = async (id) =>
	(await db.query('select name from students where account_id = $1 order by name', [id])).rows.map(
		(r) => r.name
	);
const completeReset = async (hash, pw, now = '2026-11-01Z') =>
	(await db.query('select complete_password_reset($1, $2, $3) id', [hash, pw, now])).rows[0].id;
const passwordOf = async (id) =>
	(await db.query('select password_hash from accounts where id = $1', [id])).rows[0]?.password_hash;

await check('seed gives the parent and the admin dev passwords', async () => {
	assert((await passwordOf(PARENT))?.startsWith('pbkdf2-sha256$100000$'), 'parent hash');
	assert((await passwordOf(ADMIN))?.startsWith('pbkdf2-sha256$100000$'), 'admin hash');
});

await check('password_tokens and password_failures have RLS and no policies', async () => {
	for (const t of ['password_tokens', 'password_failures']) {
		const { rows } = await db.query(
			`select relrowsecurity rls, (select count(*)::int from pg_policies where tablename = $1) policies
			   from pg_class where oid = ('public.' || $1)::regclass`,
			[t]
		);
		assert(rows[0].rls === true && rows[0].policies === 0, `${t}: ${JSON.stringify(rows[0])}`);
	}
});

await check('a reset token cannot carry registration columns', () =>
	expectCode(
		() =>
			db.query(
				`insert into password_tokens (token_hash, purpose, account_id, email, expires_at)
				 values ('x', 'reset', $1, 'a@b.c', '2030-01-01Z')`,
				[PARENT]
			),
		'23514'
	)
);

await check('a registration token needs an email', () =>
	expectCode(
		() =>
			db.query(
				`insert into password_tokens (token_hash, purpose, expires_at)
				 values ('y', 'register', '2030-01-01Z')`
			),
		'23514'
	)
);

await check('a registration token cannot name an account', () =>
	expectCode(
		() =>
			db.query(
				`insert into password_tokens (token_hash, purpose, account_id, email, expires_at)
				 values ('y', 'register', $1, 'a@b.c', '2030-01-01Z')`,
				[PARENT]
			),
		'23514'
	)
);

await check('registration creates a client account and its first student when used', async () => {
	await addRegistration('r1', 'new@example.com');
	const before = await db.query(`select 1 from accounts where email = 'new@example.com'`);
	assert(before.rows.length === 0, 'account created early');
	const id = await completeRegistration('r1', '  New Family ', 'pw-new');
	const { rows } = await db.query(
		'select name, role, password_hash, email_verified_at from accounts where id = $1',
		[id]
	);
	assert(rows[0].name === 'New Family' && rows[0].role === 'client', JSON.stringify(rows[0]));
	assert(rows[0].password_hash === 'pw-new' && rows[0].email_verified_at, 'password not active');
	const students = await studentsOf(id);
	assert(students.length === 1 && students[0] === 'New Family', JSON.stringify(students));
	assert((await completeRegistration('r1', 'Again', 'pw-x')) === null, 'token reused');
});

await check('registration with a blank name adds no student', async () => {
	await addRegistration('r5', 'blank@example.com');
	const id = await completeRegistration('r5', '   ', 'pw');
	assert(id, 'registration failed');
	assert((await studentsOf(id)).length === 0, 'student added for a blank name');
});

await check('registration needs a password hash and leaves the link usable', async () => {
	await addRegistration('r6', 'nopw@example.com');
	await db.exec('savepoint before_error');
	await expectCode(() => completeRegistration('r6', 'No Password', null), '22023');
	await db.exec('rollback to savepoint before_error');
	assert(await completeRegistration('r6', 'No Password', 'pw'), 'link was used up');
});

await check('registration for an existing email keeps name, role and students', async () => {
	await addRegistration('r2', 'PARENT@example.com');
	assert((await completeRegistration('r2', 'Impostor', 'pw-2')) === PARENT, 'wrong account');
	const { rows } = await db.query('select name, role from accounts where id = $1', [PARENT]);
	assert(rows[0].name === 'Pat Parent' && rows[0].role === 'client', JSON.stringify(rows[0]));
	assert((await passwordOf(PARENT)) === 'pw-2', 'password not replaced');
	const students = await studentsOf(PARENT);
	assert(students.join() === 'Ava,Ben', `students changed: ${students}`);
});

await check('a registration token issued before the email-only change still works', async () => {
	await db.query(
		`insert into password_tokens (token_hash, purpose, email, name, password_hash, expires_at)
		 values ('old', 'register', 'old@example.com', 'Old Name', 'old-pw', '2030-01-01Z')`
	);
	const id = await completeRegistration('old', 'New Name', 'new-pw');
	const { rows } = await db.query('select name from accounts where id = $1', [id]);
	assert(rows[0].name === 'New Name' && (await passwordOf(id)) === 'new-pw', 'old values used');
});

await check('expired and wrong-purpose tokens return null and change nothing', async () => {
	await addRegistration('r3', 'late@example.com', '2026-11-01Z');
	assert(
		(await completeRegistration('r3', 'Late', 'pw', '2026-11-01Z')) === null,
		'expired accepted'
	);
	await addReset('s1', PARENT);
	assert((await completeRegistration('s1', 'X', 'pw')) === null, 'reset used as registration');
	assert((await completeReset('r3', 'pw-x')) === null, 'registration used as reset');
	assert((await completeReset('s1', 'pw-reset')) === PARENT, 'reset token was consumed');
});

await check('reset sets the password, voids other tokens and clears the lockout', async () => {
	await addReset('s2', PARENT);
	await addReset('s3', PARENT);
	await addRegistration('r4', 'parent@example.com');
	await db.query(
		`insert into password_failures (email, failed_at) values ('Parent@Example.com', now()), ('other@example.com', now())`
	);
	assert((await completeReset('s2', 'pw-reset')) === PARENT, 'reset failed');
	assert((await passwordOf(PARENT)) === 'pw-reset', 'password not set');
	assert((await completeReset('s3', 'pw-other')) === null, 'other reset token still usable');
	assert((await completeRegistration('r4', 'P', 'pw-reg')) === null, 'pending registration usable');
	const { rows } = await db.query('select email::text from password_failures');
	assert(rows.length === 1 && rows[0].email === 'other@example.com', JSON.stringify(rows));
});

const createResetUnlessRecent = async (hash, accountId, since, now) =>
	(
		await db.query(
			`select create_reset_token_unless_recent($1, $2, '2030-01-01Z', $3, $4) created`,
			[hash, accountId, since, now]
		)
	).rows[0].created;

await check('a reset token is created only when none is unused since the cooldown', async () => {
	const at = (min) => new Date(Date.UTC(2026, 10, 1, 0, min)).toISOString();
	assert((await createResetUnlessRecent('c1', PARENT, at(-5), at(0))) === true, 'first refused');
	assert((await createResetUnlessRecent('c2', PARENT, at(-4), at(1))) === false, 'second created');
	assert((await createResetUnlessRecent('c3', ADMIN, at(-4), at(1))) === true, 'other account');
	assert((await createResetUnlessRecent('c4', PARENT, at(0), at(5))) === true, 'after cooldown');
	assert((await completeReset('c4', 'pw-reset', at(6))) === PARENT, 'cooldown token unusable');
	assert((await createResetUnlessRecent('c5', PARENT, at(2), at(7))) === true, 'after a reset');
	assert(
		(await createResetUnlessRecent('c6', '99999999-0000-0000-0000-000000000000', at(0), at(5))) ===
			false,
		'created for an unknown account'
	);
	const { rows } = await db.query(
		`select token_hash from password_tokens where token_hash like 'c%' order by token_hash`
	);
	assert(rows.map((r) => r.token_hash).join() === 'c1,c3,c4,c5', JSON.stringify(rows));
});

await check('only service_role can complete registrations and resets', async () => {
	for (const sig of [
		'complete_registration(text,text,text,timestamptz)',
		'complete_password_reset(text,text,timestamptz)',
		'create_reset_token_unless_recent(text,uuid,timestamptz,timestamptz,timestamptz)'
	]) {
		const { rows } = await db.query(
			`select has_function_privilege('anon', '${sig}', 'execute') anon,
			        has_function_privilege('authenticated', '${sig}', 'execute') authenticated,
			        has_function_privilege('service_role', '${sig}', 'execute') service_role`
		);
		assert(rows[0].anon === false, `anon can execute ${sig}`);
		assert(rows[0].authenticated === false, `authenticated can execute ${sig}`);
		assert(rows[0].service_role === true, `service_role cannot execute ${sig}`);
	}
	const { rows } = await db.query(
		`select has_function_privilege('service_role', 'password_link_used(uuid,citext,timestamptz)', 'execute') ok`
	);
	assert(rows[0].ok === false, 'service_role can call the internal helper');
});

// ---- lesson series: create with skips, top-up, end ----
const SEED_SERIES = '44444444-0000-0000-0000-0000000000b1';
const NOW = '2030-01-01T12:00:00Z';
const TUESDAYS = ['2030-03-05T20:00:00Z', '2030-03-12T19:00:00Z', '2030-03-19T19:00:00Z'];
const createSeries = (student, lesson, starts, { through = '2030-03-19', count = 3 } = {}) =>
	db.query(
		`select create_lesson_series($1, $2, 2::smallint, '15:00', 1::smallint, '2030-03-05', null,
		   $3, 'note', $4::timestamptz[], $5, $6) r`,
		[student, lesson, count, starts, through, NOW]
	);
/** Expect `code` from `run()` inside a savepoint, so the check can keep using the transaction. */
async function expectCodeKeepGoing(run, code) {
	await db.exec('savepoint s');
	await expectCode(run, code);
	await db.exec('rollback to s');
}
const seriesBookings = async (id) =>
	(
		await db.query(
			`select status::text, starts_at, price_cents, late_cancel, note, decided_at
			   from bookings where series_id = $1 order by starts_at`,
			[id]
		)
	).rows;

await check('seed creates the demo series and its weekly occurrences', async () => {
	const { rows } = await db.query(
		'select materialized_through, price_cents from lesson_series where id = $1',
		[SEED_SERIES]
	);
	assert(rows.length === 1 && rows[0].price_cents === 3000, 'seed series');
	const lessons = await seriesBookings(SEED_SERIES);
	assert(lessons.length >= 11 && lessons.length <= 13, `occurrences ${lessons.length}`);
	assert(
		lessons.every((b) => b.status === 'approved' && b.price_cents === 3000),
		'approved at the custom price'
	);
});

await check('create_lesson_series books approved occurrences at the student price', async () => {
	const { rows } = await createSeries(BEN, LESSON_30, TUESDAYS);
	const r = rows[0].r;
	assert(r.occurrences.length === 3, `occurrences ${r.occurrences.length}`);
	assert(
		r.occurrences.every((o) => o.booking_id),
		'all booked'
	);
	const lessons = await seriesBookings(r.series_id);
	assert(lessons.length === 3, `rows ${lessons.length}`);
	assert(
		lessons.every((b) => b.status === 'approved' && b.price_cents === 3000 && b.note === 'note'),
		'values'
	);
	assert(
		lessons.every((b) => b.decided_at),
		'decided_at set'
	);
	const { rows: s } = await db.query(
		'select materialized_through::text t, occurrence_count from lesson_series where id = $1',
		[r.series_id]
	);
	assert(s[0].t === '2030-03-19' && s[0].occurrence_count === 3, 'series row');
});

await check('create_lesson_series skips clashes (23P01) and past starts', async () => {
	await accountBooking(PAT, AVA, LESSON_60, '2030-03-12T18:30:00Z');
	const { rows } = await createSeries(BEN, LESSON_30, ['2029-12-31T20:00:00Z', ...TUESDAYS]);
	const booked = rows[0].r.occurrences.map((o) => o.booking_id !== null);
	assert(booked.join() === 'false,true,false,true', `booked ${booked.join()}`);
	assert((await seriesBookings(rows[0].r.series_id)).length === 2, 'two rows');
	const { rows: other } = await db.query(
		`select status::text from bookings where starts_at = '2030-03-12T18:30:00Z'`
	);
	assert(other[0].status === 'pending', 'existing booking untouched');
});

await check('create_lesson_series: unknown student P0003, inactive lesson type P0002', async () => {
	await expectCodeKeepGoing(
		() => createSeries('33333333-0000-0000-0000-0000000000ff', LESSON_30, TUESDAYS),
		'P0003'
	);
	await db.exec(`update lesson_types set active = false where id = '${LESSON_60}'`);
	await expectCodeKeepGoing(() => createSeries(BEN, LESSON_60, TUESDAYS), 'P0002');
	const { rows } = await db.query('select count(*)::int n from lesson_series');
	assert(rows[0].n === 1, `series rows ${rows[0].n}`);
});

await check('lesson_series rejects both an end date and a count', () =>
	expectCode(
		() =>
			db.exec(`insert into lesson_series (student_id, lesson_type_id, weekday, start_time,
			  interval_weeks, starts_on, ends_on, occurrence_count, price_cents)
			  values ('${BEN}', '${LESSON_30}', 2, '15:00', 1, '2030-03-05', '2030-04-01', 3, 3000)`),
		'23514'
	)
);

await check(
	'create_series_occurrences tops up and never moves materialized_through back',
	async () => {
		const { rows } = await createSeries(BEN, LESSON_30, [TUESDAYS[0]], { through: '2030-03-05' });
		const id = rows[0].r.series_id;
		const { rows: added } = await db.query(
			'select * from create_series_occurrences($1, $2::timestamptz[], $3, $4)',
			[id, TUESDAYS.slice(1), '2030-03-19', NOW]
		);
		assert(added.length === 2 && added.every((a) => a.booking_id), 'added two');
		await db.query('select * from create_series_occurrences($1, $2::timestamptz[], $3, $4)', [
			id,
			[],
			'2030-03-12',
			NOW
		]);
		const { rows: s } = await db.query(
			'select materialized_through::text t from lesson_series where id = $1',
			[id]
		);
		assert(s[0].t === '2030-03-19', `through ${s[0].t}`);
	}
);

await check('end_series cancels later live occurrences, not late, and stops top-ups', async () => {
	const { rows } = await createSeries(BEN, LESSON_30, TUESDAYS);
	const id = rows[0].r.series_id;
	// After the first lesson has started.
	const after = '2030-03-05T21:00:00Z';
	const { rows: cancelled } = await db.query('select * from end_series($1, $2, $3) id', [
		id,
		'2030-03-01T00:00:00Z',
		after
	]);
	assert(cancelled.length === 2, `cancelled ${cancelled.length}`);
	const lessons = await seriesBookings(id);
	assert(
		lessons.map((b) => b.status).join() === 'approved,cancelled,cancelled',
		`statuses ${lessons.map((b) => b.status).join()}`
	);
	assert(
		lessons.every((b) => !b.late_cancel),
		'never late'
	);
	await expectCode(
		() =>
			db.query('select * from create_series_occurrences($1, $2::timestamptz[], $3, $4)', [
				id,
				['2030-03-26T19:00:00Z'],
				'2030-03-26',
				NOW
			]),
		'P0007'
	);
});

await check('end_series and create_series_occurrences: unknown series P0006', async () => {
	const missing = '44444444-0000-0000-0000-0000000000ff';
	await expectCodeKeepGoing(
		() => db.query('select * from end_series($1, $2, $3)', [missing, NOW, NOW]),
		'P0006'
	);
	await expectCode(
		() =>
			db.query('select * from create_series_occurrences($1, $2::timestamptz[], $3, $4)', [
				missing,
				[],
				'2030-03-05',
				NOW
			]),
		'P0006'
	);
});

await check('lesson_series has RLS and anon cannot execute the series functions', async () => {
	const { rows } = await db.query(
		`select relrowsecurity from pg_class where oid = 'public.lesson_series'::regclass`
	);
	assert(rows[0]?.relrowsecurity === true, 'RLS not enabled on lesson_series');
	for (const sig of [
		'create_series_occurrences(uuid,timestamptz[],date,timestamptz)',
		'create_lesson_series(uuid,uuid,smallint,time,smallint,date,date,integer,text,timestamptz[],date,timestamptz)',
		'end_series(uuid,timestamptz,timestamptz)'
	]) {
		const { rows: p } = await db.query(
			`select has_function_privilege('anon', '${sig}', 'execute') anon,
			        has_function_privilege('authenticated', '${sig}', 'execute') authenticated,
			        has_function_privilege('service_role', '${sig}', 'execute') service_role`
		);
		assert(p[0].anon === false, `anon can execute ${sig}`);
		assert(p[0].authenticated === false, `authenticated can execute ${sig}`);
		assert(p[0].service_role === true, `service_role cannot execute ${sig}`);
	}
});

// ---- delete account ----
await check('delete_account scrubs sign-in, frees the email and keeps the history', async () => {
	const { rows: booked } = await accountBooking(PAT, AVA, LESSON_30, '2030-02-04T15:00:00Z');
	await db.exec(
		`insert into login_tokens (token_hash, account_id, expires_at)
		   values ('lt', '${PAT}', '2030-01-01');
		 insert into password_tokens (token_hash, purpose, account_id, expires_at)
		   values ('pt', 'reset', '${PAT}', '2030-01-01')`
	);
	await db.query('select delete_account($1, $2)', [PAT, '2026-11-01T00:00:00Z']);
	const { rows } = await db.query(
		`select name, email, password_hash, deleted_at from accounts where id = $1`,
		[PAT]
	);
	assert(rows[0].name === 'Pat Parent' && rows[0].deleted_at, 'row kept and marked');
	assert(rows[0].email === `deleted-${PAT}@deleted.invalid`, `email ${rows[0].email}`);
	assert(rows[0].password_hash === null, 'password kept');
	const { rows: tokens } = await db.query(
		`select (select count(*)::int from login_tokens where account_id = $1) l,
		        (select count(*)::int from password_tokens where account_id = $1) p`,
		[PAT]
	);
	assert(tokens[0].l === 0 && tokens[0].p === 0, 'tokens kept');
	const { rows: b } = await db.query('select id from bookings where id = $1', [
		booked[0].booking_id
	]);
	assert(b.length === 1, 'booking removed');
	await db.exec(`insert into accounts (name, email) values ('Pat Again', 'parent@example.com')`);
	await expectCode(
		() => db.query('select delete_account($1, $2)', [PAT, '2026-11-01T00:00:00Z']),
		'P0008'
	);
});

await check('delete_account is service-role only and refuses admins', async () => {
	const sig = 'delete_account(uuid,timestamptz)';
	const { rows: p } = await db.query(
		`select has_function_privilege('anon', '${sig}', 'execute') anon,
		        has_function_privilege('authenticated', '${sig}', 'execute') authenticated,
		        has_function_privilege('service_role', '${sig}', 'execute') service_role`
	);
	assert(!p[0].anon && !p[0].authenticated && p[0].service_role, JSON.stringify(p[0]));
	await expectCode(
		() =>
			db.query(
				`select delete_account((select id from accounts where role = 'admin' limit 1), now())`
			),
		'P0008'
	);
});

// ---- default time zone ----
await check('settings.timezone defaults to Pacific and the seed uses it', async () => {
	const { rows: def } = await db.query(
		`select column_default from information_schema.columns
		  where table_name = 'settings' and column_name = 'timezone'`
	);
	assert(
		def[0]?.column_default?.includes('America/Los_Angeles'),
		`default ${def[0]?.column_default}`
	);
	const { rows } = await db.query('select timezone from settings');
	assert(
		rows.length === 1 && rows[0].timezone === 'America/Los_Angeles',
		`seed ${rows[0]?.timezone}`
	);
	const lessons = await seriesBookings(SEED_SERIES);
	const { rows: local } = await db.query(
		`select distinct to_char(starts_at at time zone 'America/Los_Angeles', 'HH24:MI') as t
		   from bookings where series_id = $1`,
		[SEED_SERIES]
	);
	assert(
		lessons.length > 0 && local.length === 1 && local[0].t === '16:00',
		'series at 4pm Pacific'
	);
});

await check('the default time zone migration keeps a saved zone', async () => {
	await db.exec(`update settings set timezone = 'America/New_York'`);
	const mig = readdirSync(migDir).find((f) => f.endsWith('_default_timezone_pacific.sql'));
	await db.exec(readFileSync(join(migDir, mig), 'utf8'));
	const { rows } = await db.query('select timezone from settings');
	assert(rows[0].timezone === 'America/New_York', `zone ${rows[0].timezone}`);
});

await check(
	'repertoire songs need a title and a known status, and go with their student',
	async () => {
		const BEN = '33333333-0000-0000-0000-0000000000b1';
		const add = (title, status = 'learning') =>
			db.query('insert into repertoire_songs (student_id, title, status) values ($1, $2, $3)', [
				BEN,
				title,
				status
			]);
		await expectCode(() => add('Edelweiss'), null);
		await expectCodeKeepGoing(() => add('  '), '23514');
		await expectCodeKeepGoing(() => add('Moon River', 'sheet-music'), '23514');
		const { rows } = await db.query(
			`insert into students (account_id, name) values ('22222222-0000-0000-0000-00000000000b', 'Cy')
		 returning id`
		);
		await db.query(`insert into repertoire_songs (student_id, title) values ($1, 'Danny Boy')`, [
			rows[0].id
		]);
		await db.query('delete from students where id = $1', [rows[0].id]);
		const left = await db.query('select 1 from repertoire_songs where student_id = $1', [
			rows[0].id
		]);
		assert(left.rows.length === 0, 'songs left behind');
	}
);

// ---- session revocation ----
const sessionVersionOf = async (id) =>
	(await db.query('select session_version from accounts where id = $1', [id])).rows[0]
		?.session_version;

await check('every password change bumps session_version', async () => {
	const start = await sessionVersionOf(PARENT);
	await db.query(`update accounts set name = 'Pat P' where id = $1`, [PARENT]);
	assert((await sessionVersionOf(PARENT)) === start, 'non-password update bumped');
	await db.query(`update accounts set password_hash = 'x' where id = $1`, [PARENT]);
	assert((await sessionVersionOf(PARENT)) === start + 1, 'direct password update');
	await addReset('sv-reset', PARENT);
	assert((await completeReset('sv-reset', 'y')) === PARENT, 'reset');
	assert((await sessionVersionOf(PARENT)) === start + 2, 'complete_password_reset');
	await addRegistration('sv-register', 'parent@example.com');
	assert((await completeRegistration('sv-register', '', 'z')) === PARENT, 'register');
	assert((await sessionVersionOf(PARENT)) === start + 3, 'complete_registration');
	await db.query('select delete_account($1, now())', [PARENT]);
	assert((await sessionVersionOf(PARENT)) === start + 4, 'delete_account');
});

await check('revoke_sessions is service-role only and bumps live accounts', async () => {
	const sig = 'revoke_sessions(uuid)';
	const { rows: p } = await db.query(
		`select has_function_privilege('anon', '${sig}', 'execute') anon,
		        has_function_privilege('authenticated', '${sig}', 'execute') authenticated,
		        has_function_privilege('service_role', '${sig}', 'execute') service_role`
	);
	assert(!p[0].anon && !p[0].authenticated && p[0].service_role, JSON.stringify(p[0]));
	const ok = async (id) => (await db.query('select revoke_sessions($1) ok', [id])).rows[0].ok;
	const start = await sessionVersionOf(ADMIN);
	assert((await ok(ADMIN)) === true, 'admin revoke');
	assert((await sessionVersionOf(ADMIN)) === start + 1, 'admin version');
	assert((await ok('99999999-0000-0000-0000-000000000000')) === false, 'unknown account');
	await db.query('select delete_account($1, now())', [PARENT]);
	assert((await ok(PARENT)) === false, 'deleted account');
});

// ---- usage events ----
await check('usage_events are service-role only, with RLS on', async () => {
	const { rows } = await db.query(
		`select relrowsecurity rls,
		        has_table_privilege('anon', 'usage_events', 'select') anon,
		        has_table_privilege('authenticated', 'usage_events', 'insert') authenticated,
		        has_table_privilege('service_role', 'usage_events', 'insert') service_role
		   from pg_class where relname = 'usage_events'`
	);
	const r = rows[0];
	assert(r.rls && !r.anon && !r.authenticated && r.service_role, JSON.stringify(r));
});

for (const [label, sql] of [
	['an unknown kind', `insert into usage_events (kind) values ('click')`],
	[
		'an over-long duration',
		`insert into usage_events (kind, duration_ms) values ('page_view', 1800001)`
	],
	[
		'a too-short visit id',
		`insert into usage_events (kind, visit_id) values ('page_view', 'short')`
	]
]) {
	await check(`usage_events reject ${label}`, () => expectCode(() => db.exec(sql), '23514'));
}

await check("delete_account forgets the account's usage events", async () => {
	await db.query(
		`insert into usage_events (kind, account_id, route) values ('page_view', $1, '/account'),
		        ('page_view', null, '/book')`,
		[PAT]
	);
	await db.query('select delete_account($1, $2)', [PAT, '2026-11-01T00:00:00Z']);
	const { rows } = await db.query(
		`select (select count(*)::int from usage_events where account_id = $1) mine,
		        (select count(*)::int from usage_events where account_id is null) guests`,
		[PAT]
	);
	assert(rows[0].mine === 0 && rows[0].guests === 1, JSON.stringify(rows[0]));
});

// Supabase's pg_safeupdate rejects DELETE/UPDATE without a WHERE, even inside functions.
await check('migrations have no DELETE without a WHERE clause', () => {
	for (const f of readdirSync(migDir)) {
		const unguarded = readFileSync(join(migDir, f), 'utf8').match(/delete\s+from\s+\w+\s*;/gi);
		assert(!unguarded, `${f}: ${unguarded?.join(' | ')}`);
	}
});

console.table(results);
process.exit(results.every(([, r]) => r === 'ok') ? 0 : 1);

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

console.table(results);
process.exit(results.every(([, r]) => r === 'ok') ? 0 : 1);

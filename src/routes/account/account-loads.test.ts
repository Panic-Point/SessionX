import { isRedirect } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoData } from '#lib/server/store/demo-data.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import type { Account } from '#lib/server/store/types.ts';
import { SESSION_COOKIE, verifySession } from '#lib/server/auth/session.ts';
import { load as homeLoad } from './(tabs)/+page.server';
import { actions as familyActions, load as familyLoad } from './(tabs)/family/+page.server';
import { load as repertoireLoad } from './(tabs)/repertoire/+page.server';
import { actions as securityActions, load as securityLoad } from './(tabs)/security/+page.server';
import { actions as cancelActions, load as cancelLoad } from './cancel/[id]/+page.server';

const ctx = vi.hoisted(() => ({ store: undefined as unknown as MemoryBookingStore }));
vi.mock('#lib/server/context.ts', () => ({
	getStore: () => ctx.store,
	getMailer: () => ({ send: async () => {} }),
	getAppUrl: () => 'https://example.test',
	getCalendar: () => undefined,
	getSessionSecret: () => 'test-secret'
}));

// Defense in depth: every /account load and action enforces the guard itself, because a data
// request can skip layout loads. A signed-out visitor must be redirected before any store access.
const handlers = {
	'load /account': homeLoad,
	'load /account/family': familyLoad,
	'action /account/family?/addStudent': familyActions.addStudent,
	'action /account/family?/renameStudent': familyActions.renameStudent,
	'load /account/repertoire': repertoireLoad,
	'load /account/security': securityLoad,
	'action /account/security?/password': securityActions.password,
	'action /account/security?/signOutEverywhere': securityActions.signOutEverywhere,
	'action /account/security?/deleteAccount': securityActions.deleteAccount,
	'load /account/cancel/[id]': cancelLoad,
	'action /account/cancel/[id]': cancelActions.default
} as const;

async function run(name: keyof typeof handlers): Promise<unknown> {
	const event = {
		locals: { account: null },
		params: { id: 'b1' },
		url: new URL('http://localhost/account'),
		request: new Request('http://localhost/account', { method: 'POST', body: new FormData() })
	};
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (handlers[name] as any)(event);
	} catch (e) {
		return e;
	}
}

describe('account loads and actions', () => {
	it.each(Object.keys(handlers) as (keyof typeof handlers)[])(
		'%s redirects a signed-out visitor to /login',
		async (name) => {
			const result = await run(name);
			expect(isRedirect(result)).toBe(true);
			expect(result).toMatchObject({ status: 303, location: '/login' });
		}
	);
});

describe('account lessons period', () => {
	const pat: Account = {
		id: '22222222-0000-0000-0000-00000000000b',
		name: 'Pat Parent',
		email: 'parent@example.com',
		role: 'client'
	};
	const LESSON_30 = '11111111-0000-0000-0000-000000000030';
	const AVA = '33333333-0000-0000-0000-0000000000a1';
	const start = DateTime.now()
		.setZone(demoData().settings.timezone)
		.plus({ days: 10 })
		.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
	let patBooking = '';
	let otherBooking = '';

	beforeEach(async () => {
		ctx.store = new MemoryBookingStore(demoData());
		const now = new Date();
		const mine = await ctx.store.requestAccountBooking(
			{
				accountId: pat.id,
				studentId: AVA,
				lessonTypeId: LESSON_30,
				startsAt: start.toJSDate(),
				note: ''
			},
			now
		);
		patBooking = mine.bookingId;
		const theirs = await ctx.store.requestGuestBooking(
			{
				email: 'other@example.com',
				accountName: 'Other Family',
				studentName: 'Zed',
				lessonTypeId: LESSON_30,
				startsAt: start.plus({ hours: 2 }).toJSDate(),
				note: ''
			},
			now
		);
		otherBooking = theirs.bookingId;
	});

	async function home(query: string) {
		const event = { locals: { account: pat }, url: new URL(`http://localhost/account?${query}`) };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (await (homeLoad as any)(event)) as {
			period: { label: string; error: string | null } | null;
			inPeriod: { id: string; statusLabel: string }[] | null;
			upcoming: { id: string }[];
			student: { id: string; name: string } | null;
			periodParams: Record<string, string>;
		};
	}

	it('keeps upcoming and past without a period', async () => {
		const data = await home('');
		expect(data.period).toBeNull();
		expect(data.inPeriod).toBeNull();
		expect(data.upcoming.map((b) => b.id)).toContain(patBooking);
	});

	it("lists only the family's own lessons in the chosen month", async () => {
		const data = await home(`period=month&date=${start.toFormat('yyyy-MM')}`);
		expect(data.period?.label).toBe(start.toFormat('LLLL yyyy'));
		const ids = data.inPeriod?.map((b) => b.id) ?? [];
		expect(ids).toContain(patBooking);
		expect(ids).not.toContain(otherBooking);
		expect(data.upcoming).toEqual([]);
	});

	it('never errors on bad params, and shows no list for a reversed range', async () => {
		await expect(home('period=week&date=2026-02-31')).resolves.toBeTruthy();
		const data = await home('period=custom&from=2026-11-20&to=2026-11-02');
		expect(data.period?.error).toBeTruthy();
		expect(data.inPeriod).toBeNull();
	});

	it("narrows to one of the family's students and keeps the period", async () => {
		const BEN = '33333333-0000-0000-0000-0000000000b1';
		const ben = await home(`student=${BEN}&period=month&date=${start.toFormat('yyyy-MM')}`);
		expect(ben.student).toEqual({ id: BEN, name: 'Ben' });
		expect(ben.periodParams).toEqual({ period: 'month', date: start.toFormat('yyyy-MM') });
		expect(ben.inPeriod?.map((b) => b.id)).not.toContain(patBooking);
		const ava = await home(`student=${AVA}`);
		expect(ava.upcoming.map((b) => b.id)).toContain(patBooking);
	});

	it("ignores a student that isn't the family's", async () => {
		const other = (await ctx.store.findAccountByEmail('other@example.com'))!;
		const [zedStudent] = await ctx.store.listStudents(other.id);
		const data = await home(`student=${zedStudent.id}`);
		expect(data.student).toBeNull();
		expect(data.upcoming.map((b) => b.id)).toContain(patBooking);
	});
});

describe('/account/repertoire', () => {
	const pat: Account = {
		id: '22222222-0000-0000-0000-00000000000b',
		name: 'Pat Parent',
		email: 'parent@example.com',
		role: 'client'
	};
	const AVA = '33333333-0000-0000-0000-0000000000a1';
	const BEN = '33333333-0000-0000-0000-0000000000b1';

	it("lists each of the family's students with their songs, and no one else's", async () => {
		ctx.store = new MemoryBookingStore(demoData());
		const song = { artist: '', notes: '' };
		await ctx.store.addSong(AVA, { ...song, title: 'Moon River', status: 'ready' });
		await ctx.store.addSong(AVA, { ...song, title: 'Edelweiss', status: 'learning' });
		const other = await ctx.store.createAccount('Other', 'other@example.com');
		const zed = await ctx.store.addStudent(other.id, 'Zed');
		await ctx.store.addSong(zed.id, { ...song, title: 'Hidden', status: 'learning' });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const data = (await (repertoireLoad as any)({ locals: { account: pat } })) as {
			students: { id: string; name: string; songs: { title: string; statusLabel: string }[] }[];
		};
		expect(
			data.students.map((s) => [s.id, s.songs.map((x) => `${x.title}: ${x.statusLabel}`)])
		).toEqual([
			[AVA, ['Edelweiss: Learning', 'Moon River: Ready to perform']],
			[BEN, []]
		]);
	});
});

describe('/account/security delete account', () => {
	const pat: Account = {
		id: '22222222-0000-0000-0000-00000000000b',
		name: 'Pat Parent',
		email: 'parent@example.com',
		role: 'client'
	};

	beforeEach(() => {
		ctx.store = new MemoryBookingStore(demoData());
	});

	function event(fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const deleted: string[] = [];
		return {
			deleted,
			event: {
				locals: { account: pat },
				cookies: { delete: (name: string) => deleted.push(name) },
				request: new Request('http://localhost/account/security', { method: 'POST', body })
			}
		};
	}

	async function call(e: ReturnType<typeof event>['event']): Promise<unknown> {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return await (securityActions.deleteAccount as any)(e);
		} catch (err) {
			return err;
		}
	}

	it('keeps the account and session on a wrong password', async () => {
		const { deleted, event: e } = event({ deletePassword: 'wrong-password' });
		const result = await call(e);
		expect(result).toMatchObject({
			status: 400,
			data: { target: 'delete', errors: { currentPassword: 'Current password is incorrect.' } }
		});
		expect(deleted).toEqual([]);
		expect(await ctx.store.findAccountById(pat.id)).not.toBeNull();
	});

	it('deletes the account, signs out and goes home', async () => {
		const { deleted, event: e } = event({ deletePassword: 'sessionx-parent-dev1' });
		const result = await call(e);
		expect(isRedirect(result)).toBe(true);
		expect(result).toMatchObject({ status: 303, location: '/?accountDeleted=1' });
		expect(deleted).toEqual(['sx_session']);
		expect(await ctx.store.findAccountById(pat.id)).toBeNull();
	});
});

describe('/account/security sessions', () => {
	const pat: Account = {
		id: '22222222-0000-0000-0000-00000000000b',
		name: 'Pat Parent',
		email: 'parent@example.com',
		role: 'client'
	};

	beforeEach(() => {
		ctx.store = new MemoryBookingStore(demoData());
	});

	function event(fields: Record<string, string> = {}) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const set = new Map<string, string>();
		const deleted: string[] = [];
		return {
			set,
			deleted,
			event: {
				locals: { account: pat },
				cookies: {
					set: (name: string, value: string) => set.set(name, value),
					delete: (name: string) => deleted.push(name)
				},
				request: new Request('http://localhost/account/security', { method: 'POST', body })
			}
		};
	}

	async function versionOf(id: string): Promise<number | undefined> {
		return (await ctx.store.findSessionAccount(id))?.sessionVersion;
	}

	it('sign out everywhere revokes every session and signs this device out', async () => {
		const before = await versionOf(pat.id);
		const { deleted, event: e } = event();
		let result: unknown;
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (securityActions.signOutEverywhere as any)(e);
		} catch (err) {
			result = err;
		}
		expect(result).toMatchObject({ status: 303, location: '/?signedOutEverywhere=1' });
		expect(deleted).toEqual([SESSION_COOKIE]);
		expect(await versionOf(pat.id)).toBe(before! + 1);
	});

	it('a password change revokes other sessions but keeps this device signed in', async () => {
		const before = await versionOf(pat.id);
		const { set, event: e } = event({
			currentPassword: 'sessionx-parent-dev1',
			password: 'a-brand-new-passphrase-7',
			confirmPassword: 'a-brand-new-passphrase-7'
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await (securityActions.password as any)(e);
		expect(result).toMatchObject({ message: 'Password changed.' });
		const after = await versionOf(pat.id);
		expect(after).toBe(before! + 1);
		const session = await verifySession(set.get(SESSION_COOKIE), 'test-secret', new Date());
		expect(session).toMatchObject({ accountId: pat.id, sessionVersion: after });
	});
});

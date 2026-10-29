import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCalendar, type FakeCalendar } from '#lib/server/calendar/fake-client.test-helpers.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import type { Account } from '#lib/server/store/types.ts';

const ctx = vi.hoisted(() => ({
	store: undefined as unknown as MemoryBookingStore,
	calendar: undefined as unknown as FakeCalendar,
	configError: null as string | null
}));
vi.mock('#lib/server/context.ts', () => ({
	getStore: () => ctx.store,
	getCalendar: () => ctx.calendar,
	getAppUrl: () => 'https://example.test',
	getCalendarStatus: () => ({
		enabled: ctx.calendar.enabled,
		serviceAccountEmail: ctx.calendar.serviceAccountEmail,
		configError: ctx.configError
	})
}));

const { actions, load } = await import('./+page.server');

const admin: Account = {
	id: 'a1',
	name: 'Teacher',
	email: 'admin@sessionx.local',
	role: 'admin'
};
const client: Account = { id: 'c1', name: 'Pat', email: 'pat@example.com', role: 'client' };

const baseForm = {
	timezone: 'America/New_York',
	minNoticeHours: '24',
	maxAdvanceDays: '60',
	slotIncrementMin: '30',
	bufferMin: '15',
	cancelCutoffHours: '48',
	cancellationPolicyText: 'Be kind.',
	adminEmail: ''
};

function post(account: Account | null, fields: Record<string, string> = {}) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		locals: { account },
		request: new Request('http://localhost/admin/settings', { method: 'POST', body })
	};
}

async function run<T>(fn: () => Promise<T>): Promise<unknown> {
	try {
		return await fn();
	} catch (e) {
		return e;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (fn: unknown, event: unknown) => (fn as any)(event);

beforeEach(() => {
	ctx.store = new MemoryBookingStore();
	ctx.calendar = fakeCalendar();
	ctx.configError = null;
});

describe('/admin/settings load', () => {
	it('returns the service account email and calendar values, never key material', async () => {
		await ctx.store.updateSettings({
			...(await ctx.store.getSettings()),
			gcalWriteCalendarId: 'lessons@x.com',
			gcalBusyCalendarIds: ['a@x.com', 'b@x.com']
		});
		const data = (await call(load, { locals: { account: admin } })) as Record<string, unknown>;
		expect(data.calendar).toEqual({
			serviceAccountEmail: 'sa@example.iam.gserviceaccount.com',
			configError: null
		});
		expect(data.values).toMatchObject({
			gcalWriteCalendarId: 'lessons@x.com',
			gcalBusyCalendarIds: 'a@x.com\nb@x.com'
		});
		expect(JSON.stringify(data)).not.toMatch(/private_key|PRIVATE KEY|GOOGLE_SERVICE_ACCOUNT_JSON/);
	});

	it('passes through a config error with no email when the client is disabled', async () => {
		ctx.calendar = fakeCalendar(false);
		ctx.configError = 'GOOGLE_SERVICE_ACCOUNT_JSON is invalid';
		const data = (await call(load, { locals: { account: admin } })) as Record<string, unknown>;
		expect(data.calendar).toEqual({
			serviceAccountEmail: null,
			configError: 'GOOGLE_SERVICE_ACCOUNT_JSON is invalid'
		});
	});
});

describe('/admin/settings save', () => {
	it('uses only named actions (SvelteKit rejects default alongside named)', () => {
		expect(Object.keys(actions).sort()).toEqual(['checkConnection', 'save', 'syncLessons']);
	});

	it('forbids a client', async () => {
		const result = await run(() => call(actions.save, post(client, baseForm)));
		expect(isHttpError(result)).toBe(true);
		expect(result).toMatchObject({ status: 403 });
	});

	it('persists the calendar fields', async () => {
		const result = await call(
			actions.save,
			post(admin, {
				...baseForm,
				gcalWriteCalendarId: ' lessons@x.com ',
				gcalBusyCalendarIds: 'a@x.com, b@x.com\na@x.com'
			})
		);
		expect(result).toMatchObject({ saved: true });
		const s = await ctx.store.getSettings();
		expect(s.gcalWriteCalendarId).toBe('lessons@x.com');
		expect(s.gcalBusyCalendarIds).toEqual(['a@x.com', 'b@x.com']);
	});

	it('clears the calendar fields when they are blank', async () => {
		await ctx.store.updateSettings({
			...(await ctx.store.getSettings()),
			gcalWriteCalendarId: 'lessons@x.com',
			gcalBusyCalendarIds: ['a@x.com']
		});
		await call(actions.save, post(admin, baseForm));
		const s = await ctx.store.getSettings();
		expect(s.gcalWriteCalendarId).toBeNull();
		expect(s.gcalBusyCalendarIds).toEqual([]);
	});

	it('re-renders with the calendar error and keeps what was typed', async () => {
		const ids = Array.from({ length: 11 }, (_, i) => `c${i}@x.com`).join('\n');
		const result = await call(actions.save, post(admin, { ...baseForm, gcalBusyCalendarIds: ids }));
		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({
			status: 400,
			data: { errors: { gcalBusyCalendarIds: 'Use at most 10 calendars.' } }
		});
		// Form submission normalizes textarea line breaks to CRLF.
		const typed = (result as { data: { values: Record<string, string> } }).data.values;
		expect(typed.gcalBusyCalendarIds.replace(/\r\n/g, '\n')).toBe(ids);
	});
});

describe('/admin/settings checkConnection', () => {
	it('redirects a signed-out visitor', async () => {
		const result = await run(() => call(actions.checkConnection, post(null)));
		expect(isRedirect(result)).toBe(true);
		expect(ctx.calendar.busyCalls).toEqual([]);
	});

	it('forbids a client', async () => {
		const result = await run(() => call(actions.checkConnection, post(client)));
		expect(isHttpError(result)).toBe(true);
		expect(result).toMatchObject({ status: 403 });
		expect(ctx.calendar.busyCalls).toEqual([]);
	});

	it('returns the result lines for the saved calendars', async () => {
		await ctx.store.updateSettings({
			...(await ctx.store.getSettings()),
			gcalWriteCalendarId: 'lessons@x.com',
			gcalBusyCalendarIds: []
		});
		const result = await call(actions.checkConnection, post(admin));
		expect(result).toEqual({ check: { ok: true, lines: ['lessons@x.com: OK'] } });
	});

	it('reports the not-configured message when the client is disabled', async () => {
		ctx.calendar = fakeCalendar(false);
		const result = await call(actions.checkConnection, post(admin));
		expect(result).toEqual({
			check: {
				ok: false,
				lines: ['Google Calendar is not configured on the server (GOOGLE_SERVICE_ACCOUNT_JSON).']
			}
		});
	});
});

describe('/admin/settings syncLessons', () => {
	const PARENT = '22222222-0000-0000-0000-00000000000b';
	const AVA = '33333333-0000-0000-0000-0000000000a1';
	const LESSON_30 = '11111111-0000-0000-0000-000000000030';

	async function bookUpcoming() {
		const now = new Date();
		const startsAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
		startsAt.setUTCMinutes(0, 0, 0);
		await ctx.store.createApprovedBooking(
			{ accountId: PARENT, studentId: AVA, lessonTypeId: LESSON_30, startsAt, note: '' },
			now
		);
	}

	async function saveLessonCalendar() {
		await ctx.store.updateSettings({
			...(await ctx.store.getSettings()),
			gcalWriteCalendarId: 'lessons@x.com'
		});
	}

	it('forbids a client', async () => {
		const result = await run(() => call(actions.syncLessons, post(client)));
		expect(isHttpError(result)).toBe(true);
		expect(result).toMatchObject({ status: 403 });
	});

	it('asks for setup when there is no lesson calendar', async () => {
		await bookUpcoming();
		const result = await call(actions.syncLessons, post(admin));
		expect(result).toMatchObject({ sync: { ok: false } });
		expect(ctx.calendar.created).toEqual([]);
	});

	it('adds upcoming lessons and then reports nothing left', async () => {
		await saveLessonCalendar();
		await bookUpcoming();
		expect(await call(actions.syncLessons, post(admin))).toEqual({
			sync: { ok: true, lines: ['Added 1 lesson.'] }
		});
		expect(ctx.calendar.created).toHaveLength(1);
		expect(await call(actions.syncLessons, post(admin))).toEqual({
			sync: { ok: true, lines: ['All upcoming lessons are already on the calendar.'] }
		});
	});

	it('reports failures', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await saveLessonCalendar();
		await bookUpcoming();
		ctx.calendar.fail.create = true;
		expect(await call(actions.syncLessons, post(admin))).toEqual({
			sync: {
				ok: false,
				lines: ['Could not add 1 lesson. Click Check connection to see why.']
			}
		});
		err.mockRestore();
	});
});

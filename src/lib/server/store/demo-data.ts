import type { DateOverride, WeeklyHours } from '../availability';
import type { AdminLessonType, SeriesInput, StudioSettings } from './types';

export interface DemoAccount {
	id: string;
	name: string;
	email: string;
	role: 'admin' | 'client';
}

export interface DemoStudent {
	id: string;
	accountId: string;
	name: string;
}

export interface DemoStudentPrice {
	studentId: string;
	lessonTypeId: string;
	priceCents: number;
}

export interface DemoPassword {
	accountId: string;
	passwordHash: string;
}

/** PBKDF2 hash of `sessionx-parent-dev1`, the dev password for parent@example.com. */
export const DEMO_PARENT_PASSWORD_HASH =
	'pbkdf2-sha256$100000$SrxEmbi8K3DoRBvKGeJD8A$MntBsUsc7LJoZA7ag7a0temG_u4UHtqC8pKFkihLRpM';

/** PBKDF2 hash of `sessionx-admin-dev1`, the dev password for admin@sessionx.local. */
export const DEMO_ADMIN_PASSWORD_HASH =
	'pbkdf2-sha256$100000$XoJK5LAwpWglGRuePzsB_g$1R37f3MKJSTIORYgEhMC8UvX4Mckm0KzRMoRGKiFH3I';

export interface DemoData {
	settings: StudioSettings;
	weeklyHours: WeeklyHours[];
	dateOverrides: DateOverride[];
	lessonTypes: AdminLessonType[];
	accounts: DemoAccount[];
	students: DemoStudent[];
	studentPrices: DemoStudentPrice[];
	passwords: DemoPassword[];
	lessonSeries: DemoSeries[];
}

export interface DemoSeries extends SeriesInput {
	id: string;
	priceCents: number;
}

/** Mirrors supabase/seed.sql (plus the column defaults from the init migration). */
export function demoData(): DemoData {
	const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '15:00', end: '20:00' }));
	return {
		settings: {
			timezone: 'America/Los_Angeles',
			minNoticeHours: 24,
			maxAdvanceDays: 60,
			slotIncrementMin: 30,
			bufferMin: 0,
			allowSameDay: false,
			cancelCutoffHours: 24,
			cancellationPolicyText:
				'Please cancel at least 24 hours before your lesson. Late cancellations may still be charged.',
			adminEmail: 'admin@sessionx.local',
			gcalWriteCalendarId: null,
			gcalBusyCalendarIds: []
		},
		weeklyHours: [...weekdays, { weekday: 6, start: '09:00', end: '13:00' }],
		dateOverrides: [],
		lessonTypes: [
			{
				id: '11111111-0000-0000-0000-000000000030',
				name: '30-minute lesson',
				description: 'Great for beginners and younger students.',
				durationMin: 30,
				priceCents: 3500,
				sortOrder: 1,
				active: true
			},
			{
				id: '11111111-0000-0000-0000-000000000045',
				name: '45-minute lesson',
				description: 'Our most popular lesson length.',
				durationMin: 45,
				priceCents: 5000,
				sortOrder: 2,
				active: true
			},
			{
				id: '11111111-0000-0000-0000-000000000060',
				name: '60-minute lesson',
				description: 'For intermediate and advanced students.',
				durationMin: 60,
				priceCents: 6500,
				sortOrder: 3,
				active: true
			}
		],
		accounts: [
			{
				id: '22222222-0000-0000-0000-00000000000a',
				name: 'Studio Admin',
				email: 'admin@sessionx.local',
				role: 'admin'
			},
			{
				id: '22222222-0000-0000-0000-00000000000b',
				name: 'Pat Parent',
				email: 'parent@example.com',
				role: 'client'
			}
		],
		students: [
			{
				id: '33333333-0000-0000-0000-0000000000a1',
				accountId: '22222222-0000-0000-0000-00000000000b',
				name: 'Ava'
			},
			{
				id: '33333333-0000-0000-0000-0000000000b1',
				accountId: '22222222-0000-0000-0000-00000000000b',
				name: 'Ben'
			}
		],
		// Ben pays $30 instead of $35 for 30-minute lessons.
		studentPrices: [
			{
				studentId: '33333333-0000-0000-0000-0000000000b1',
				lessonTypeId: '11111111-0000-0000-0000-000000000030',
				priceCents: 3000
			}
		],
		passwords: [
			{
				accountId: '22222222-0000-0000-0000-00000000000a',
				passwordHash: DEMO_ADMIN_PASSWORD_HASH
			},
			{
				accountId: '22222222-0000-0000-0000-00000000000b',
				passwordHash: DEMO_PARENT_PASSWORD_HASH
			}
		],
		// Ben's standing weekly lesson: Tuesdays at 4:00pm, no end date. Occurrences are created
		// by the daily top-up (or the seed, in Supabase).
		lessonSeries: [
			{
				id: '44444444-0000-0000-0000-0000000000b1',
				studentId: '33333333-0000-0000-0000-0000000000b1',
				lessonTypeId: '11111111-0000-0000-0000-000000000030',
				weekday: 2,
				startTime: '16:00',
				intervalWeeks: 1,
				startsOn: '2026-11-03',
				endsOn: null,
				occurrenceCount: null,
				priceCents: 3000,
				note: ''
			}
		]
	};
}

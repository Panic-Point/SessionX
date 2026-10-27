import type { DateOverride, WeeklyHours } from '../availability';
import type { AdminLessonType, StudioSettings } from './types';

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

/** PBKDF2 hash of `sessionx-parent-dev`, the dev password for parent@example.com. */
export const DEMO_PARENT_PASSWORD_HASH =
	'pbkdf2-sha256$100000$Gdn8ZFyVGVjo3_9Mvebwbg$yIhLzGXbDC1e7kTUeENArJ5AllBcXi8dKeKzYRg4V1o';

export interface DemoData {
	settings: StudioSettings;
	weeklyHours: WeeklyHours[];
	dateOverrides: DateOverride[];
	lessonTypes: AdminLessonType[];
	accounts: DemoAccount[];
	students: DemoStudent[];
	studentPrices: DemoStudentPrice[];
	passwords: DemoPassword[];
}

/** Mirrors supabase/seed.sql (plus the column defaults from the init migration). */
export function demoData(): DemoData {
	const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '15:00', end: '20:00' }));
	return {
		settings: {
			timezone: 'America/New_York',
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
				accountId: '22222222-0000-0000-0000-00000000000b',
				passwordHash: DEMO_PARENT_PASSWORD_HASH
			}
		]
	};
}

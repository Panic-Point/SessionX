import { createClient } from '@supabase/supabase-js';
import { describe } from 'vitest';
import { runAccountStoreContract } from './account-contract';
import { runAdminStoreContract } from './admin-contract';
import { runBookingStoreContract } from './contract';
import { runRepertoireStoreContract } from './repertoire-contract';
import { runSeriesStoreContract } from './series-contract';
import { runUsageStoreContract } from './usage-contract';
import { demoData } from './demo-data';
import { runPasswordStoreContract } from './password-contract';
import { createSupabaseBookingStore } from './supabase';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Restores the seed. Order matters: bookings reference students and lesson types (ON DELETE
 * RESTRICT), and students reference accounts.
 */
async function resetToSeed() {
	const db = createClient(url!, key!, { auth: { persistSession: false } });
	const seed = demoData();
	const list = (ids: string[]) => `(${ids.join(',')})`;
	const check = (error: { message: string } | null) => {
		if (error) throw new Error(`reset failed: ${error.message}`);
	};

	// Tokens and bookings are never seeded, so remove all of them.
	check((await db.from('login_tokens').delete().not('token_hash', 'is', null)).error);
	check((await db.from('password_tokens').delete().not('token_hash', 'is', null)).error);
	check((await db.from('password_failures').delete().not('id', 'is', null)).error);
	check((await db.from('usage_events').delete().not('id', 'is', null)).error);
	check((await db.from('bookings').delete().not('id', 'is', null)).error);
	check((await db.from('repertoire_songs').delete().not('id', 'is', null)).error);
	// Only the seed's series stays, un-materialised (its seeded occurrences went with the bookings).
	check(
		(
			await db
				.from('lesson_series')
				.delete()
				.not('id', 'in', list(seed.lessonSeries.map((x) => x.id)))
		).error
	);
	check(
		(
			await db
				.from('lesson_series')
				.update({ materialized_through: null, ended_at: null })
				.not('id', 'is', null)
		).error
	);
	check(
		(
			await db
				.from('students')
				.delete()
				.not('id', 'in', list(seed.students.map((s) => s.id)))
		).error
	);
	check(
		(
			await db
				.from('accounts')
				.delete()
				.not('id', 'in', list(seed.accounts.map((a) => a.id)))
		).error
	);

	// Seed students: restore names and notes; account notes cleared. Prices (cascaded away with
	// deleted students) are reset to exactly the seed set once the lesson types exist.
	check(
		(
			await db.from('students').upsert(
				seed.students.map((st) => ({
					id: st.id,
					account_id: st.accountId,
					name: st.name,
					notes: ''
				}))
			)
		).error
	);
	check(
		(
			await db
				.from('accounts')
				.update({ admin_notes: '', password_hash: null })
				.not('id', 'is', null)
		).error
	);
	for (const p of seed.passwords) {
		check(
			(await db.from('accounts').update({ password_hash: p.passwordHash }).eq('id', p.accountId))
				.error
		);
	}

	// Lesson types: drop non-seed ones, then restore the seed rows (active, names, prices).
	check(
		(
			await db
				.from('lesson_types')
				.delete()
				.not('id', 'in', list(seed.lessonTypes.map((t) => t.id)))
		).error
	);
	check(
		(
			await db.from('lesson_types').upsert(
				seed.lessonTypes.map((t) => ({
					id: t.id,
					name: t.name,
					description: t.description,
					duration_min: t.durationMin,
					price_cents: t.priceCents,
					sort_order: t.sortOrder,
					active: t.active
				}))
			)
		).error
	);

	check((await db.from('student_prices').delete().not('student_id', 'is', null)).error);
	check(
		(
			await db.from('student_prices').insert(
				seed.studentPrices.map((p) => ({
					student_id: p.studentId,
					lesson_type_id: p.lessonTypeId,
					price_cents: p.priceCents
				}))
			)
		).error
	);

	const s = seed.settings;
	check(
		(
			await db
				.from('settings')
				.update({
					timezone: s.timezone,
					min_notice_hours: s.minNoticeHours,
					max_advance_days: s.maxAdvanceDays,
					slot_increment_min: s.slotIncrementMin,
					buffer_min: s.bufferMin,
					allow_same_day: s.allowSameDay,
					cancel_cutoff_hours: s.cancelCutoffHours,
					cancellation_policy_text: s.cancellationPolicyText,
					admin_email: s.adminEmail,
					gcal_write_calendar_id: s.gcalWriteCalendarId,
					gcal_busy_calendar_ids: s.gcalBusyCalendarIds
				})
				.eq('id', true)
		).error
	);
	check((await db.rpc('replace_weekly_hours', { p_hours: seed.weeklyHours })).error);
	// Ranges cascade with their override.
	check((await db.from('date_overrides').delete().not('date', 'is', null)).error);
}

// Needs a running local Supabase (`npx supabase db reset` once, then any number of runs: the
// contract suites restore the seed before every test).
describe.skipIf(!url || !key)('supabase store', () => {
	runBookingStoreContract(
		'supabase',
		async () => createSupabaseBookingStore(url!, key!),
		resetToSeed
	);
	runAdminStoreContract(
		'supabase',
		async () => createSupabaseBookingStore(url!, key!),
		resetToSeed
	);
	runAccountStoreContract(
		'supabase',
		async () => createSupabaseBookingStore(url!, key!),
		resetToSeed
	);
	runSeriesStoreContract(
		'supabase',
		async () => createSupabaseBookingStore(url!, key!),
		resetToSeed
	);
	runPasswordStoreContract(
		'supabase',
		async () => createSupabaseBookingStore(url!, key!),
		resetToSeed
	);
	runRepertoireStoreContract(
		'supabase',
		async () => createSupabaseBookingStore(url!, key!),
		resetToSeed
	);
	runUsageStoreContract(
		'supabase',
		async () => createSupabaseBookingStore(url!, key!),
		resetToSeed
	);
});

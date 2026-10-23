import { createClient } from '@supabase/supabase-js';
import { describe } from 'vitest';
import { runBookingStoreContract } from './contract';
import { demoData } from './demo-data';
import { createSupabaseBookingStore } from './supabase';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Deletes everything a contract test may have created, back to the seed. Order matters:
 * bookings reference students (ON DELETE RESTRICT), and students reference accounts.
 */
async function resetToSeed() {
	const db = createClient(url!, key!, { auth: { persistSession: false } });
	const seed = demoData();
	const list = (ids: string[]) => `(${ids.join(',')})`;
	const steps = [
		// Bookings are never seeded, so remove all of them.
		db.from('bookings').delete().not('id', 'is', null),
		db
			.from('students')
			.delete()
			.not('id', 'in', list(seed.students.map((s) => s.id))),
		db
			.from('accounts')
			.delete()
			.not('id', 'in', list(seed.accounts.map((a) => a.id)))
	];
	for (const step of steps) {
		const { error } = await step;
		if (error) throw new Error(`reset failed: ${error.message}`);
	}
}

// Needs a running local Supabase (`npx supabase db reset` once, then any number of runs: the
// contract suite resets bookings, students and accounts to the seed before every test).
describe.skipIf(!url || !key)('supabase store', () => {
	runBookingStoreContract(
		'supabase',
		async () => createSupabaseBookingStore(url!, key!),
		resetToSeed
	);
});

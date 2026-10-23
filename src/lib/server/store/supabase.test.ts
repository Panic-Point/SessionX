import { describe } from 'vitest';
import { runBookingStoreContract } from './contract';
import { createSupabaseBookingStore } from './supabase';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Needs a running local Supabase. This test does NOT reset the database: it expects a freshly
// seeded one (`npx supabase db reset`) and leaves bookings behind, so reset before each run.
describe.skipIf(!url || !key)('supabase store', () => {
	runBookingStoreContract('supabase', async () => createSupabaseBookingStore(url!, key!));
});

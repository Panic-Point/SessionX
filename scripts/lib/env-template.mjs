/** Turns .env.local.example into a Supabase-backed .env.local. */
export function renderLocalEnv(template, { serviceKey, anonKey, supabaseUrl }) {
	return template
		.replace(/^BOOKING_STORE=.*$/m, 'BOOKING_STORE=')
		.replace(/^#\s*SUPABASE_URL=.*$/m, `SUPABASE_URL=${supabaseUrl}`)
		.replace(/^#\s*SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`)
		.replace(/^PUBLIC_SUPABASE_ANON_KEY=.*$/m, `PUBLIC_SUPABASE_ANON_KEY=${anonKey}`);
}

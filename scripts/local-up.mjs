import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { run, requireDocker } from './lib/run.mjs';
import { renderLocalEnv } from './lib/env-template.mjs';

await requireDocker();

await run('npx', ['supabase', 'start']);
// `supabase start` only runs migrations when it creates the database, so apply any added since.
await run('npx', ['supabase', 'migration', 'up', '--local']);

if (!existsSync('.env.local')) {
	const status = await run('npx', ['supabase', 'status', '-o', 'env'], { capture: true });
	const vars = Object.fromEntries(
		status
			.split(/\r?\n/)
			.map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
			.filter(Boolean)
			.map((m) => [m[1], m[2]])
	);
	const serviceKey = vars.SERVICE_ROLE_KEY ?? vars.SECRET_KEY;
	const anonKey = vars.ANON_KEY ?? vars.PUBLISHABLE_KEY;
	const env = renderLocalEnv(readFileSync('.env.local.example', 'utf8'), {
		serviceKey,
		anonKey,
		supabaseUrl: vars.API_URL ?? 'http://127.0.0.1:54321'
	});
	writeFileSync('.env.local', env);
	console.log('Wrote .env.local from the running Supabase stack.');
}

// -V recreates the node_modules volume so dependency changes in the rebuilt image take effect.
await run('docker', ['compose', 'up', '-d', '--build', '-V', 'app']);

console.log(`
SessionX is running:
  App              http://localhost:5173
  Supabase Studio  http://localhost:54323
  Mailpit (email)  http://localhost:54324

Stop with: npm run local:down
`);

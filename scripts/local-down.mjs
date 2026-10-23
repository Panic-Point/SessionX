import { run, requireDocker } from './lib/run.mjs';

await requireDocker();
await run('docker', ['compose', 'down']);
await run('npx', ['supabase', 'stop']);

import { run, requireDocker } from './lib/run.mjs';

// Drops the local database, re-runs every migration, then loads supabase/seed.sql.
await requireDocker();
await run('npx', ['supabase', 'db', 'reset']);

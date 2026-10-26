# Local development

Everything runs locally in Docker: the Supabase stack (Postgres, Auth, Studio, Mailpit) via the
Supabase CLI, and the SvelteKit app via `docker-compose.yml`.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running)
- Node.js 22+ (`npm install` once, so the Supabase CLI is available via `npx supabase`)

## Commands

| Command               | What it does                                                                           |
| --------------------- | -------------------------------------------------------------------------------------- |
| `npm run local:up`    | Starts Supabase, writes `.env.local` on first run, builds and starts the app container |
| `npm run local:down`  | Stops the app container and the Supabase stack                                         |
| `npm run local:reset` | Wipes the local database, re-runs `supabase/migrations/*`, loads `supabase/seed.sql`   |
| `npm test`            | Unit tests (Vitest), no Docker needed                                                  |
| `npm run test:db`     | Database tests (pgTAP, `supabase/tests/*.test.sql`) against the local stack            |
| `npm run test:all`    | Formatting check, type check, and unit tests (what CI runs)                            |

All commands work from PowerShell and bash.

## URLs

| Service          | URL                    |
| ---------------- | ---------------------- |
| App              | http://localhost:5173  |
| Supabase Studio  | http://localhost:54323 |
| Mailpit (emails) | http://localhost:54324 |
| Supabase API     | http://localhost:54321 |

## Seed data

`supabase/seed.sql` creates an admin (`admin@sessionx.local`), weekday and Saturday hours, three
lesson types, and a family account (`parent@example.com`) with two students, Ava and Ben. Ben has a
custom price on the 30-minute lesson.

## Deploying

See [deploy.md](deploy.md) for putting the app on the internet.

## Running the app without Docker

`npm run dev` works too, as long as the Supabase stack is up (`npx supabase start`) and
`.env.local` exists.

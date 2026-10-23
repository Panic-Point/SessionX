# Milestone 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable SvelteKit project with local Docker scripts, the full database schema + seed, and the two core pure-logic modules (slot availability and price resolution) fully unit-tested.

**Architecture:** SvelteKit (TypeScript) targeting Cloudflare Pages; Supabase local stack via the Supabase CLI (Docker) plus an app container from `docker-compose.yml`; cross-platform Node scripts behind npm. Availability and pricing are pure functions with no I/O so later milestones wire DB/Google data into them.

**Tech Stack:** SvelteKit 2/3 + Svelte 5, `@sveltejs/adapter-cloudflare`, Vite, Vitest, Luxon (timezone math), Supabase CLI (`supabase` npm dev dep), Postgres + pgTAP, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-23-booking-app-design.md`

Later milestones (own plans): 2 guest booking flow + emails · 3 admin auth/requests/settings · 4 accounts, students, cancel · 5 Google Calendar · 6 PWA, Turnstile, cron, deploy.

## Global Constraints

- All DB access server-side only; browser never talks to Supabase directly.
- Times stored as `timestamptz` (UTC); all day/hour logic in `settings.timezone` via Luxon.
- Money as integer cents.
- Scripts must run from PowerShell and bash (Node `.mjs`, no shell-only scripts).
- Defaults: `slot_increment_min = 30`, `buffer_min = 0`.
- Deviation from spec (my call, serves goal 8's "no same-day bookings"): add `settings.allow_same_day boolean default false`, applied in addition to `min_notice_hours`.

## Review Focus

1. DST change days (e.g. 2026-03-08 America/New_York): slots must be at correct local wall-clock times, none in the skipped hour → test in Task 4.
2. A date override closing a day that has weekly hours → no slots that day → Task 4.
3. Lesson longer than what's left of a window → no partial slot at the window end → Task 4.
4. Candidate exactly at `now + min_notice` boundary is allowed; one minute earlier is not → Task 4.
5. A signed-in account viewing a student that isn't theirs gets list price, never the custom price → Task 5.

---

### Task 1: Scaffold SvelteKit app + CI

**Files:** Create `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/app.html`, `src/app.d.ts`, `src/routes/+page.svelte`, `src/lib/index.ts`, `.gitignore`, `.github/workflows/ci.yml`, `src/lib/smoke.test.ts`

**Interfaces:** Produces npm scripts `dev`, `build`, `check`, `test` (vitest run), `test:all`.

- [ ] Step 1: Scaffold minimal TS SvelteKit app (`npx sv create`, minimal template, TypeScript, no add-ons) into the repo root, keeping README and docs.
- [ ] Step 2: Swap to `@sveltejs/adapter-cloudflare`; add `vitest`, `luxon`, `@types/luxon`; `vite.config.ts` test include `src/**/*.test.ts`.
- [ ] Step 3: `src/lib/smoke.test.ts` — `expect(1 + 1).toBe(2)`; run `npm test` → PASS.
- [ ] Step 4: `npm run check` and `npm run build` → both exit 0.
- [ ] Step 5: `ci.yml` on push/PR: Node 22, `npm ci`, `npm run check`, `npm test`, `npm run build`.
- [ ] Step 6: Commit `chore: scaffold SvelteKit app with Cloudflare adapter and CI`.

### Task 2: Local Docker stack + scripts

**Files:** Create `supabase/config.toml` (via `npx supabase init`), `docker-compose.yml`, `Dockerfile.dev`, `.env.local.example`, `scripts/local-up.mjs`, `scripts/local-down.mjs`, `scripts/local-reset.mjs`, `scripts/lib/run.mjs`, `docs/local-dev.md`

**Interfaces:** npm scripts `local:up`, `local:down`, `local:reset`, `test:db` (`supabase test db`). App container serves `http://localhost:5173`; Supabase API `http://localhost:54321`, Studio `54323`, Mailpit/Inbucket `54324` (CLI defaults).

- [ ] Step 1: `npx supabase init`; set `project_id = "sessionx"`, `[auth] site_url = "http://localhost:5173"`.
- [ ] Step 2: `Dockerfile.dev` (node:22-alpine, `npm ci`, `npm run dev -- --host 0.0.0.0`); compose service `app` with source bind-mount, port 5173, `env_file: .env.local`, `extra_hosts: host.docker.internal:host-gateway`, `PUBLIC_SUPABASE_URL=http://host.docker.internal:54321`.
- [ ] Step 3: `scripts/lib/run.mjs` exports `run(cmd: string, args: string[]): Promise<void>` (spawn, inherit stdio, `shell: process.platform === 'win32'`, reject on non-zero). `local-up` checks `docker info` (clear message if Docker not running), runs `npx supabase start`, writes `.env.local` from `npx supabase status -o env` if missing, `docker compose up -d --build app`, prints URLs. `local-down`: compose down + `supabase stop`. `local-reset`: `supabase db reset`.
- [ ] Step 4: `docs/local-dev.md`: prerequisites (Docker Desktop, Node 22+), commands, URLs.
- [ ] Step 5: Verify (requires Docker): `npm run local:up` → app at 5173 returns 200; Studio reachable. If Docker unavailable, record as unverified.
- [ ] Step 6: Commit `chore: local Docker stack and scripts`.

### Task 3: Schema, constraint, seed

**Files:** Create `supabase/migrations/20261023000000_init.sql`, `supabase/seed.sql`, `supabase/tests/bookings_overlap.test.sql`

**Interfaces:** Tables and columns exactly as spec "Data model", plus `settings.allow_same_day`. Enum `booking_status ('pending','approved','declined','cancelled','expired')`, enum `account_role ('client','admin')`. `settings` singleton enforced by `id boolean primary key default true check (id)`. RLS enabled on every table, no policies.

- [ ] Step 1: Write pgTAP test: insert approved booking 10:00–11:00; `throws_ok` inserting pending 10:30–11:30 (SQLSTATE `23P01`); `lives_ok` inserting 11:00–12:00; `lives_ok` inserting 10:30–11:30 when the first is `cancelled`.
- [ ] Step 2: Migration: `create extension if not exists btree_gist; create extension if not exists citext;` tables; exclusion constraint on `bookings`:

```sql
alter table bookings add constraint bookings_no_overlap
  exclude using gist (tstzrange(starts_at, blocked_until, '[)') with &&)
  where (status in ('pending','approved'));
```
  where `blocked_until timestamptz not null` = `ends_at + buffer` set by the app at insert (keeps constraint immutable-expression-safe). Check `ends_at > starts_at`, `blocked_until >= ends_at`.
- [ ] Step 3: Seed: settings (`America/New_York`, min_notice 24, max_advance 60, cancel_cutoff 24, allow_same_day false, admin_email `admin@sessionx.local`), Mon–Fri 15:00–20:00 + Sat 09:00–13:00, lesson types (30-min $35, 45-min $50, 60-min $65), admin account, family account `parent@example.com` with students "Ava" and "Ben", custom price for Ben on 30-min = $30.
- [ ] Step 4: `npm run local:reset && npm run test:db` → all pgTAP pass (requires Docker).
- [ ] Step 5: Commit `feat: database schema, overlap constraint, seed`.

### Task 4: Availability engine (TDD)

**Files:** Create `src/lib/server/availability.ts`, `src/lib/server/availability.test.ts`

**Interfaces — Produces:**
```ts
export interface WeeklyHours { weekday: number /* ISO 1=Mon..7=Sun */; start: string /* HH:mm */; end: string }
export interface TimeRange { start: string; end: string }
export interface DateOverride { date: string /* yyyy-MM-dd */; isClosed: boolean; ranges: TimeRange[] }
export interface BookingRules { timezone: string; minNoticeHours: number; maxAdvanceDays: number; slotIncrementMin: number; bufferMin: number; allowSameDay: boolean }
export interface Interval { start: Date; end: Date }
export interface SlotQuery { durationMin: number; fromDate: string; toDate: string /* inclusive, yyyy-MM-dd in rules.timezone */; now: Date }
export type SlotsByDate = Record<string, string[] /* ISO UTC start times, ascending */>
export function getAvailableSlots(q: SlotQuery, rules: BookingRules, hours: WeeklyHours[], overrides: DateOverride[], busy: Interval[]): SlotsByDate
```
Every date in `[fromDate, toDate]` appears as a key (empty array = greyed out). Overlap rule mirrors the DB: candidate `[s, s+duration+buffer)` conflicts with busy `[b.start, b.end+buffer)`.

Tests (rules: `America/New_York`, notice 24, advance 60, increment 30, buffer 0, allowSameDay false; hours Mon 15:00–17:00; now = 2026-11-01T12:00 local, a Sunday):
- [ ] Step 1: Write failing tests:
  - `generates slots inside weekly hours` — Mon 2026-11-02, 60 min → `15:00, 15:30, 16:00` local (as UTC ISO `20:00Z, 20:30Z, 21:00Z`).
  - `no partial slot at window end` — 90 min → `15:00, 15:30` only.
  - `closed override empties the day` — override 2026-11-02 closed → `[]`.
  - `override ranges replace weekly hours` — override 2026-11-02 ranges 10:00–11:00, 60 min → `10:00` only.
  - `busy interval removes overlapping slots` — busy 15:30–16:00 local, 30 min → `15:00, 16:00, 16:30`.
  - `buffer blocks adjacent slot` — buffer 15, busy 15:00–15:30, 30 min → first slot `16:00` (15:30 start blocked since busy blocked_until 15:45; 15:30+30+15 increments) — assert `15:30` absent, `16:00` present.
  - `min notice boundary` — now = 2026-11-01T15:00 local; Mon 15:00 exactly 24h later → included; now 15:01 → excluded.
  - `no same day when disallowed` — notice 0, now Mon 2026-11-02T09:00 → Mon empty; with allowSameDay true → Mon has slots.
  - `max advance` — advance 1 day, query through 2026-11-09 → only 2026-11-02 non-empty among Mondays.
  - `DST spring forward` — hours Sun 01:00–04:00, date 2026-03-08, now 2026-03-01, 60 min → exactly `["2026-03-08T06:00:00.000Z","2026-03-08T06:30:00.000Z","2026-03-08T07:00:00.000Z"]` (01:00 EST, 01:30 EST, 03:00 EDT). Candidates step on local wall clock, skipping nonexistent wall times (02:00, 02:30); a candidate fits if `start + duration` in real time ≤ window end in real time. Fit uses duration only; buffer applies only to the conflict check.
  - `every date in range is a key` — range 2026-11-01..2026-11-03 → keys exactly those three.
- [ ] Step 2: `npx vitest run src/lib/server/availability.test.ts` → FAIL (module missing).
- [ ] Step 3: Implement with Luxon: per date, windows = override (closed → none; ranges → those) else weekly hours for that ISO weekday; step from window start by `slotIncrementMin` in local wall time; keep if fits, passes notice/same-day/advance, no busy conflict.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat: availability engine`.

### Task 5: Price resolution (TDD)

**Files:** Create `src/lib/server/pricing.ts`, `src/lib/server/pricing.test.ts`

**Interfaces — Produces:**
```ts
export type Viewer = { kind: 'guest' } | { kind: 'account'; accountId: string } | { kind: 'admin' }
export interface PriceContext { listPriceCents: number; studentAccountId: string | null; customPriceCents: number | null }
export function displayPriceCents(viewer: Viewer, ctx: PriceContext): number
export function effectivePriceCents(ctx: PriceContext): number   // snapshot stored on booking: custom ?? list
```
- [ ] Step 1: Failing tests:
  - `guest sees list price even when custom exists` → 3500 (list 3500, custom 3000).
  - `account sees own student's custom price` → 3000.
  - `account sees list price when no custom` → 3500.
  - `account never sees another account's custom price` (studentAccountId 'B', viewer 'A') → 3500.
  - `admin sees custom` → 3000.
  - `effective price prefers custom` → 3000; `falls back to list` → 3500.
- [ ] Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.
- [ ] Step 5: Commit `feat: price resolution rules`.

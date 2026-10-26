# Milestone 6 — Installable App, Spam Protection, Scheduled Jobs, Deploy Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SessionX can be installed to a phone's home screen, the guest booking form is protected by Cloudflare Turnstile, a scheduled job keeps the free Supabase project awake and expires stale requests, and the repo has everything needed to deploy to Cloudflare Pages (config, docs, README) once the human setup issues (#11–#15) are done.

**Architecture:** Expiry is a new store method (conditional update, both stores) called from a pure `runScheduledJobs`, exposed at `POST /api/cron` behind a bearer secret and triggered hourly by a GitHub Actions workflow. Turnstile is a small fetch-based verifier called from the guest branch of `/book/details`. The PWA uses a web manifest, generated PNG icons, and SvelteKit's built-in `src/service-worker.ts` (no plugin). Deploy readiness is config + docs, plus a test that keeps documented env vars in sync with `src/env.ts`.

**Tech Stack:** SvelteKit 3.1 (`$service-worker`), Svelte 5, TypeScript, Vitest, Cloudflare Turnstile siteverify API, GitHub Actions, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-10-23-booking-app-design.md` (Goal 5 installable web app; Architecture → Bot check, Scheduled jobs, PWA; Build order step 9). HITL tracking: GitHub issue #7 (children #8–#18).

## Global Constraints

- SvelteKit 3: `dev` from `$app/env`; server env declared in `src/env.ts` and read via `$app/env/private`. Never import `$lib/server` into `.svelte`.
- **Cron:** `POST /api/cron` only. `Authorization: Bearer {CRON_SECRET}` compared in constant time (`crypto.subtle` HMAC compare or equal-length XOR loop). Missing/wrong secret → `401`, no work done. `CRON_SECRET` unset → `503` outside dev (refuse rather than run open); in dev unset → `503` too (the endpoint is never open). Response JSON `{ ok: true, expired: number }`.
- **Expiry:** `pending` bookings with `startsAt <= now` become `expired` (frees the slot; never touches approved/declined/cancelled; idempotent). No email on expiry (_controller ruling: spec doesn't ask; the teacher simply didn't act_).
- **Turnstile:** only the **guest** booking submit is checked (signed-in families are known accounts). Env `TURNSTILE_SITE_KEY` (sent to the page via load data) and `TURNSTILE_SECRET_KEY`. When either is unset, the widget isn't rendered and verification is skipped (_controller ruling: keeps dev and pre-setup deploys working; docs mark it required for production_). When configured: missing token or siteverify `success:false` → form error `Please complete the spam check and try again.` (key `form`), no booking; siteverify network error/timeout (5 s) → **fail open**, log, continue (_controller ruling_). Never log the secret.
- **Service worker:** precache only built assets and `static/` files; navigations are network-first with an `/offline` fallback page; never cache `POST`, `__data.json`, `/api/*`, `/admin*`, `/account*`, `/login*`, `/logout`, `/manage/*`, or any response with `Set-Cookie`. Cache name includes the SvelteKit `version`; old caches deleted on `activate`; `skipWaiting` + `clients.claim`.
- Manifest: name `SessionX`, short_name `SessionX`, `start_url: '/'`, `display: 'standalone'`, theme/background colours from the existing CSS variables, icons 192, 512, and 512 maskable PNG; iOS `apple-touch-icon` 180 PNG and `apple-mobile-web-app-*` meta.
- Every env var declared in `src/env.ts` (plus `TURNSTILE_SITE_KEY`) must be documented in `docs/deploy.md` and present (commented if optional) in `.env.local.example`.
- No AI attribution lines in issues or PR bodies (repo convention); commit trailers as instructed by the controller.
- npm installs: `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" …`. Docker unavailable.

## Review Focus

1. `/api/cron` with no header, wrong secret, a secret differing only in length/case, or `CRON_SECRET` unset → 401/503 and no bookings change → Task 2 tests.
2. Expiry flips only past pending requests, frees their slot, is idempotent, and leaves approved past lessons alone → Task 1 contract + service tests.
3. Guest submit with missing/failed Turnstile token (when configured) → `Please complete the spam check and try again.`, no booking; signed-in submit never checked; siteverify outage → booking proceeds, error logged → Task 3 tests.
4. Service worker never serves cached personal or admin pages, `__data.json`, or POST results; a new deploy replaces old caches → Task 4 tests on the pure routing helper.
5. Every server env var the code reads is documented → Task 5 `env vars are documented` test.

---

### Task 1: Expire stale requests (store + scheduled job service)

**Files:** Modify `src/lib/server/store/types.ts`, `memory.ts`, `supabase.ts`, `admin-contract.ts`. Create `src/lib/server/scheduled-jobs.ts` (+test).

**Interfaces — Produces:**

```ts
// AdminStore gains:
expirePendingBookings(now: Date): Promise<number>;   // pending AND startsAt <= now → 'expired'; returns count
// scheduled-jobs.ts
export interface ScheduledJobsResult { expired: number }
export async function runScheduledJobs(store: AppStore, now: Date): Promise<ScheduledJobsResult>
  // calls getSettings() first (touches the DB — keeps the free Supabase project awake), then expirePendingBookings(now)
```

Supabase: `.from('bookings').update({ status: 'expired' }).eq('status', 'pending').lte('starts_at', now.toISOString()).select('id')` → length.

- [ ] Step 1: Contract tests: `expires past pending requests and frees the slot` (create pending at a time, expire with now after it, `getLiveBookings` excludes it, status `expired`), `leaves future pending alone`, `leaves approved past lessons alone`, `is idempotent` (second call returns 0). Service tests: `runScheduledJobs reads settings then expires`, `returns the count`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: expire stale pending requests`.

### Task 2: Cron endpoint + GitHub Actions schedule

**Files:** Create `src/routes/api/cron/+server.ts`, `src/lib/server/cron-auth.ts` (+test), `src/routes/api/cron/cron.test.ts`, `.github/workflows/cron.yml`. Modify `src/env.ts` (`CRON_SECRET`).

**Interfaces:**

```ts
// cron-auth.ts
export type CronAuth = { ok: true } | { ok: false; status: 401 | 503 };
export async function checkCronAuth(
	header: string | null,
	secret: string | undefined
): Promise<CronAuth>;
// secret unset/empty → 503; header must be exactly `Bearer {secret}`; constant-time comparison; else 401
```

- `+server.ts` exports `POST` only: `checkCronAuth` → on failure `json({ ok:false }, { status })`; on success `json({ ok:true, ...await runScheduledJobs(getStore(), new Date()) })`. Errors → 500 `{ ok:false }` with `console.error` (no secret).
- `cron.yml`: `on: schedule: - cron: '7 * * * *'` and `workflow_dispatch`; job runs `curl -fsS -X POST -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ secrets.APP_URL }}/api/cron"`; first step exits 0 with a notice when `APP_URL` or `CRON_SECRET` secrets are empty (so the workflow is green before deploy).
- [ ] Step 1: Tests: `checkCronAuth` (unset → 503, empty → 503, missing header → 401, wrong secret → 401, `Bearer` with extra space → 401, different length → 401, correct → ok); endpoint (memory store; 401 leaves a past pending request pending; 200 expires it and returns `{ ok:true, expired:1 }`; GET is not exported).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS; `npm run build`.
- [ ] Step 5: Commit `feat: secret-protected cron endpoint and hourly GitHub Actions trigger`.

### Task 3: Cloudflare Turnstile on the guest booking form

**Files:** Create `src/lib/server/turnstile.ts` (+test). Modify `src/env.ts` (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`), `src/routes/book/details/+page.server.ts` (+ existing details action test), `src/routes/book/details/+page.svelte`, `src/app.html` only if needed.

**Interfaces:**

```ts
export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing' | 'rejected' };
export async function verifyTurnstile(
	token: string | null,
	remoteIp: string | null,
	secret: string | undefined,
	fetchFn?: typeof fetch
): Promise<TurnstileResult>;
// secret unset → { ok:true } (disabled); token empty → missing; POST https://challenges.cloudflare.com/turnstile/v0/siteverify (form-encoded secret, response, remoteip) with AbortSignal.timeout(5000);
// success:false → rejected; network/timeout/non-2xx → console.error (no secret) and { ok:true } (fail open)
```

- Guest branch of the details action: read `cf-turnstile-response` from the form, `event.getClientAddress()` for remote IP (wrap in try/catch → null), verify before `submitGuestRequest`; failure → `fail(400, { values, errors: { form: 'Please complete the spam check and try again.' } })`. Signed-in branch untouched.
- Load returns `turnstileSiteKey` only when both keys are set. Page renders the widget (`<div class="cf-turnstile" data-sitekey=…>` + `https://challenges.cloudflare.com/turnstile/v0/api.js` script loaded only when the key is present) in the guest form, and shows `errors.form`.
- [ ] Step 1: Tests: verifier (disabled, missing, success, rejected, network error fails open + logs without the secret, request body/URL/timeout); action (configured + missing token → 400 form error and no booking; configured + success → booking; signed-in submit never calls siteverify; unconfigured → no check).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: Turnstile spam check on guest bookings`.

### Task 4: Installable app (manifest, icons, service worker, offline page)

**Files:** Create `static/manifest.webmanifest`, `static/icons/icon-192.png`, `static/icons/icon-512.png`, `static/icons/icon-maskable-512.png`, `static/icons/apple-touch-icon.png`, `scripts/generate-icons.mjs` (pure Node: zlib + CRC32 PNG encoder, draws a simple branded mark — run once, commit outputs), `src/service-worker.ts`, `src/lib/sw-routing.ts` (+test), `src/routes/offline/+page.svelte`. Modify `src/app.html` (manifest link, theme-color, apple meta).

**Interfaces:**

```ts
// sw-routing.ts (pure, importable by the service worker and tests)
export type SwStrategy = 'precache' | 'network-first-navigation' | 'network-only';
export function swStrategy(
	req: { method: string; url: string; mode?: string; destination?: string },
	precached: Set<string>,
	origin: string
): SwStrategy;
// non-GET, other origin, __data.json, /api/, /admin, /account, /login, /logout, /manage/ → network-only
// pathname in precached → precache; navigation (mode 'navigate') → network-first-navigation; else network-only
```

- `service-worker.ts`: uses `build`, `files`, `version` from `$service-worker`; cache `sessionx-${version}` with `[...build, ...files, '/offline']`; `install` → precache + `skipWaiting`; `activate` → delete other caches + `clients.claim`; `fetch` → by `swStrategy`; network-first navigation falls back to cached `/offline`; never `cache.put` responses with `Set-Cookie` or non-200.
- `/offline` page: "You're offline" + "Try again" link; prerender it (`export const prerender = true` in `+page.ts`).
- [ ] Step 1: `sw-routing.test.ts`: each network-only rule (POST, other origin, `/book/__data.json`, `/api/cron`, `/admin/lessons`, `/account`, `/login/verify`, `/logout`, `/manage/abc`), precached asset, navigation to `/book` → network-first, unknown GET asset → network-only. Icon script test optional; verify PNG signature + IHDR dimensions of generated files in a test.
- [ ] Step 2: FAIL. Step 3: Implement + generate icons. Step 4: PASS; `npm run build` (service worker bundles); manifest served at `/manifest.webmanifest` in `vite dev` smoke.
- [ ] Step 5: Commit `feat: installable web app with offline fallback`.

### Task 5: Deploy readiness (config, docs, README, env sync test)

**Files:** Create `docs/deploy.md`, `src/lib/server/env-docs.test.ts`. Modify `README.md`, `.env.local.example`, `wrangler.jsonc` (only if needed for Pages), `docs/local-dev.md` (link to deploy doc).

**Content:**

- `docs/deploy.md` — production checklist mirroring issues #11–#15: domain → Resend → Supabase (`npx supabase link`, `npx supabase db push`, insert settings + teacher admin account + `role='admin'`, no seed) → Cloudflare Pages via Git integration (build command `npm run build`, output `.svelte-kit/cloudflare`, env `NODE_VERSION=22`), Production secrets table (every var: purpose, required?, example) incl. `CRON_SECRET`, `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` (create a Turnstile widget in Cloudflare for the domain), `GOOGLE_SERVICE_ACCOUNT_JSON` (link to `docs/google-calendar.md`) → GitHub Actions secrets `APP_URL`, `CRON_SECRET` → post-deploy checks (sign in, book, approve, cron run via "Run workflow", install to home screen on iPhone/Android).
- `README.md` — what SessionX is, feature list, tech stack, quick start (`npm install`, `npm run dev` with sample data, sign-in links printed in terminal), tests, links to `docs/local-dev.md`, `docs/deploy.md`, `docs/google-calendar.md`, and issue #7.
- `env-docs.test.ts`: parse variable names from `src/env.ts` (`defineEnvVars` keys) and assert each appears in `docs/deploy.md` and `.env.local.example`.
- [ ] Step 1: env-docs test → FAIL (new vars undocumented). Step 2: write docs/README/example → PASS.
- [ ] Step 3: `npm run check`, `npx vitest run`, `npm run lint`, `npm run build`.
- [ ] Step 4: Commit `docs: deployment guide, README, env documentation check`.

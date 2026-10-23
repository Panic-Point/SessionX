# Milestone 3 — Admin: Sign-in, Requests, Lessons, Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The teacher signs in with an emailed link and, under `/admin`, approves or declines requests (booker emailed; approval carries an `.ics`), sees upcoming/past lessons and marks them paid, and edits booking rules + cancellation policy, weekly hours, date overrides, and lesson types.

**Architecture:** Extends Milestone 2's store pattern: a new `AdminStore` interface implemented by the same `MemoryBookingStore` class and the same Supabase store object (so guest bookings appear in admin), with a shared contract suite. Sign-in is **app-managed magic links** (hashed single-use tokens in a `login_tokens` table + an HMAC-signed session cookie via Web Crypto) sent through the existing `Mailer` — works identically in memory mode, Docker, and Workers. Admin logic lives in a pure `admin-service`; routes are thin form actions.

**Tech Stack:** SvelteKit 3 / Svelte 5 runes, `@supabase/supabase-js`, Luxon, Web Crypto (`crypto.subtle`, `crypto.getRandomValues`), Vitest, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-23-booking-app-design.md` (Goals 3, 4, 7, 8, 10; "Key flows → Approve/decline", "Admin screens"; "Auth"). Milestone 2 plan for existing interfaces: `docs/superpowers/plans/2026-10-23-milestone-2-guest-booking.md`.

**Deviation from spec (controller ruling):** the spec names Supabase Auth magic links. This plan uses app-managed magic links instead — no Supabase Auth/custom-SMTP setup, same emails/transport as bookings, testable without Docker, and identical in memory mode. `accounts.auth_user_id` stays unused. Cost if wrong: swap the login service for Supabase Auth later; session/guard code is unaffected.

## Global Constraints

- All DB access server-side; never import `$lib/server`/`#lib/server` into `.svelte` or `+page.ts`.
- Only accounts with `role = 'admin'` reach `/admin/**`; unauthenticated → `303 /login`; signed-in non-admin → `403`.
- Login tokens: 32 random bytes, base64url; stored only as SHA-256 hex; expire after 15 minutes; single use. Login link `${appUrl}/login/verify?token=…`. The verify page consumes the token only on **POST** (button), never on GET (mail scanners prefetch links).
- `/login` never reveals whether an email has an account: same response either way.
- Session cookie `sx_session`: `base64url(JSON payload).base64url(HMAC-SHA256)`, payload `{ accountId, exp }` (unix seconds, 30 days); `httpOnly`, `sameSite: 'lax'`, `secure: !dev`, `path: '/'`.
- `SESSION_SECRET` env: required outside dev (throw a clear Error, mirroring `chooseStore`); dev fallback is a fixed constant.
- Times UTC in storage; displayed in `settings.timezone`. Money integer cents; admin price inputs are dollars (`35` or `35.00`).
- Email failures never fail an admin action (log and continue). All user text in email HTML escaped.
- Workers runtime: no Node built-ins in server code (`crypto` = global Web Crypto; base64 via `btoa`/`atob` + `TextEncoder`).
- npm installs: `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" …` (global npm broken). Docker unavailable: Supabase-backed code verified by PGlite (SQL) and by reading; contract suite skips without `SUPABASE_URL`.

## Review Focus

1. Expired, reused, or unknown login token → no session, generic "This sign-in link is invalid or has expired." → Task 2 contract `consumeLoginToken is single use / rejects expired`, Task 4 `completeLogin rejects reused token`.
2. Tampered or expired session cookie (edited payload, wrong signature, past `exp`) → treated as signed out → Task 4 `verifySession rejects tampered payload / bad signature / expired`.
3. Double approve, or approve after decline/cancel → friendly "This request was already handled.", no second email → Task 2 contract `decideBooking on non-pending throws not_pending`, Task 5 `decide on handled request returns message and sends nothing`.
4. Admin hours with overlapping or inverted ranges, invalid time zone, or non-numeric rule values → field errors, nothing saved → Task 5 validation tests.
5. Non-admin or anonymous request to any `/admin` page or action → redirect/403, no data → Task 6 `adminGuard` tests + smoke curls.

---

### Task 1: SQL — login tokens + admin RPCs

**Files:** Create `supabase/migrations/20261023020000_admin.sql`, `supabase/tests/admin.test.sql`. Modify `scripts/db-check.mjs` (new checks).

**Interfaces — Produces:**

```sql
create table login_tokens (
  token_hash text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);  -- RLS enabled, no policies
replace_weekly_hours(p_hours jsonb) returns void
  -- p_hours: [{"weekday":1,"start":"15:00","end":"20:00"}, …]; deletes all weekly_hours rows then inserts these, in one transaction
save_date_override(p_date date, p_is_closed boolean, p_note text, p_ranges jsonb) returns void
  -- upserts date_overrides row; replaces that date's date_override_ranges with p_ranges ([{"start":"10:00","end":"12:00"}]); when p_is_closed, ranges are cleared
-- both: security definer, set search_path = public, execute revoked from public/anon/authenticated, granted to service_role
```

- [ ] Step 1: Add db-check checks (+ pgTAP equivalents): `login_tokens has RLS`, `replace_weekly_hours replaces all rows` (seed has 6 → call with 2 → count 2, values match), `replace_weekly_hours rejects end <= start` (23514, and original rows survive — transaction), `save_date_override inserts closed day with no ranges`, `save_date_override replaces ranges on re-save`, `save_date_override closed clears ranges`, `anon cannot execute either function`.
- [ ] Step 2: `npm run test:db:lite` → new checks FAIL.
- [ ] Step 3: Write the migration. Step 4: `npm run test:db:lite` → all ok.
- [ ] Step 5: Commit `feat: login tokens table and admin schedule functions`.

### Task 2: `AdminStore` interface + memory implementation + contract

**Files:** Modify `src/lib/server/store/types.ts`, `src/lib/server/store/memory.ts`, `src/lib/server/store/demo-data.ts`. Create `src/lib/server/store/admin-contract.ts`, `src/lib/server/store/memory-admin.test.ts`.

**Interfaces — Produces (add to `types.ts`):**

```ts
export type AccountRole = 'client' | 'admin';
export interface Account { id: string; name: string; email: string; role: AccountRole }
export interface AdminLessonType extends LessonType { active: boolean }
export interface LessonTypeInput { name: string; description: string; durationMin: number; priceCents: number; sortOrder: number; active: boolean }
export interface DateOverrideWithNote extends DateOverride { note: string }
export interface AdminBooking {
  id: string; status: BookingStatus; startsAt: Date; endsAt: Date;
  lessonTypeName: string; durationMin: number; studentName: string; accountName: string; accountEmail: string;
  priceCents: number; paidAt: Date | null; note: string; declineReason: string | null; lateCancel: boolean; manageToken: string;
}
export interface BookingFilter { statuses: BookingStatus[]; from?: Date; to?: Date; unpaidOnly?: boolean; order: 'asc' | 'desc' }  // from inclusive, to exclusive, on startsAt
export type AdminStoreErrorCode = 'not_found' | 'not_pending' | 'in_past';
export class AdminStoreError extends Error { constructor(public readonly code: AdminStoreErrorCode) }
export interface AdminStore {
  findAccountByEmail(email: string): Promise<Account | null>;      // trim + case-insensitive
  findAccountById(id: string): Promise<Account | null>;
  createLoginToken(accountId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumeLoginToken(tokenHash: string, now: Date): Promise<string | null>;  // accountId; marks used; null if unknown/used/expired (expiresAt <= now)
  listBookings(filter: BookingFilter): Promise<AdminBooking[]>;
  getBooking(id: string): Promise<AdminBooking | null>;
  decideBooking(id: string, decision: 'approved' | 'declined', reason: string | null, now: Date): Promise<AdminBooking>;
    // not_found; not_pending if status != pending; in_past if approving and startsAt <= now. Sets decided_at; declined stores reason.
  setPaid(id: string, paidAt: Date | null): Promise<AdminBooking>;   // not_found
  updateSettings(settings: StudioSettings): Promise<void>;
  replaceWeeklyHours(hours: WeeklyHours[]): Promise<void>;
  listDateOverrides(fromDate: string): Promise<DateOverrideWithNote[]>;   // date >= fromDate, ascending
  saveDateOverride(override: DateOverrideWithNote): Promise<void>;
  deleteDateOverride(date: string): Promise<void>;
  listAllLessonTypes(): Promise<AdminLessonType[]>;                   // incl. inactive, by sortOrder then name
  createLessonType(input: LessonTypeInput): Promise<AdminLessonType>;
  updateLessonType(id: string, input: LessonTypeInput): Promise<AdminLessonType>;  // not_found
}
```

`MemoryBookingStore` implements both `BookingStore` and `AdminStore` over the same data (an admin-approved booking stays live; a declined one frees its slot). Demo lesson types get `active: true`; `getActiveLessonTypes` filters on it (and the guest booking path rejects inactive types with `lesson_type_not_found`, matching SQL). `admin-contract.ts` exports `runAdminStoreContract(name, makeStore: () => Promise<BookingStore & AdminStore>, reset?: () => Promise<void>)`.

- [ ] Step 1: Contract tests (use `requestGuestBooking` to create bookings at 2030 dates): `finds admin account by email case-insensitively`, `unknown email returns null`, `consumeLoginToken is single use`, `consumeLoginToken rejects expired`, `lists pending bookings ascending with account and student names`, `decideBooking approves pending`, `decideBooking declines with reason and frees the slot` (same slot bookable again), `decideBooking on non-pending throws not_pending`, `approving a past booking throws in_past`, `unknown booking throws not_found`, `setPaid sets and clears paidAt`, `unpaidOnly filter excludes paid`, `updateSettings round-trips`, `replaceWeeklyHours replaces`, `saveDateOverride then listDateOverrides`, `deleteDateOverride removes`, `createLessonType then listAllLessonTypes`, `inactive lesson type hidden from getActiveLessonTypes`, `updateLessonType unknown id throws not_found`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS (incl. existing M2 suites).
- [ ] Step 5: Commit `feat: admin store interface and in-memory implementation`.

### Task 3: Supabase admin store

**Files:** Modify `src/lib/server/store/supabase.ts`, `src/lib/server/store/supabase-mappers.ts`, `src/lib/server/store/supabase-mappers.test.ts`, `src/lib/server/store/supabase.test.ts`.

**Interfaces:** `createSupabaseBookingStore(url, key)` now returns `BookingStore & AdminStore`. New mappers: `mapAccountRow`, `mapAdminBookingRow`, `mapAdminLessonTypeRow`, `mapOverridesWithNotes`. `supabase.test.ts` also runs `runAdminStoreContract` (skipped without env; extend the existing reset hook to also delete `login_tokens`, restore seed settings/hours/lesson types — re-insert from `demoData()`).

- `consumeLoginToken`: `update({used_at}).eq('token_hash').is('used_at', null).gt('expires_at', now.toISOString()).select('account_id')` → first row or null.
- `decideBooking`: conditional update `.eq('id').eq('status','pending')` (+ `.gt('starts_at', now)` when approving) `.select(…)`; if no row, `getBooking` to choose `not_found` / `not_pending` / `in_past`.
- `replaceWeeklyHours`/`saveDateOverride` call the Task 1 RPCs.
- [ ] Step 1: Mapper tests (account role, admin booking row with embeds `students(name, accounts(name, email))`, `lesson_types(name, duration_min)`, null paid_at/decline_reason, override notes grouping).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS (contract skipped). `npm run build` succeeds.
- [ ] Step 5: Commit `feat: Supabase admin store`.

### Task 4: Auth (tokens, session, login service) + new emails + `.ics`

**Files:** Create `src/lib/server/auth/tokens.ts`, `src/lib/server/auth/session.ts`, `src/lib/server/auth/login-service.ts`, `src/lib/server/email/ics.ts`, and tests for each. Modify `src/lib/server/email/mailer.ts` (attachments), `src/lib/server/email/templates.ts` (+tests).

**Interfaces — Produces:**

```ts
// tokens.ts
export function generateToken(): string; // 32 random bytes, base64url, no padding
export async function hashToken(token: string): Promise<string>; // SHA-256 lowercase hex
// session.ts
export const SESSION_COOKIE = 'sx_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export interface SessionPayload {
	accountId: string;
	exp: number;
}
export async function signSession(payload: SessionPayload, secret: string): Promise<string>;
export async function verifySession(
	cookie: string | undefined,
	secret: string,
	now: Date
): Promise<SessionPayload | null>; // constant-time compare via crypto.subtle.verify
// login-service.ts
export interface LoginDeps {
	store: AdminStore;
	mailer: Mailer;
	appUrl: string;
}
export async function requestLoginLink(deps: LoginDeps, email: string, now: Date): Promise<void>; // no-op for unknown email; 15-min token; email via loginLinkEmail; mailer errors logged
export async function completeLogin(
	store: AdminStore,
	token: string,
	now: Date
): Promise<Account | null>;
// ics.ts
export interface IcsEvent {
	uid: string;
	start: Date;
	end: Date;
	summary: string;
	description: string;
	url: string;
	now: Date;
}
export function buildIcs(e: IcsEvent): string; // VCALENDAR/VEVENT, PRODID:-//SessionX//Booking//EN, METHOD:PUBLISH, UTC times YYYYMMDDTHHMMSSZ, CRLF line endings, TEXT escaping (\\ ; , \n), lines folded at 75 octets
// mailer.ts — EmailMessage gains: attachments?: { filename: string; contentType: string; content: string /* UTF-8 text */ }[]
//   resend: attachments: [{ filename, content: base64 }]; mailpit: Attachments: [{ Filename, ContentType, Content: base64 }]
// templates.ts
export function loginLinkEmail(to: string, name: string, url: string): EmailMessage; // subject: `Your SessionX sign-in link`
export function bookingApprovedEmail(
	d: BookingEmailData,
	bookingId: string,
	now: Date
): EmailMessage;
// subject: `Lesson confirmed – {lessonTypeName} on {formatDateTime}`; attachment `lesson.ics` (text/calendar) uid `${bookingId}@sessionx`
export function bookingDeclinedEmail(d: BookingEmailData, reason: string | null): EmailMessage;
// subject: `Lesson request declined – {lessonTypeName} on {formatDateTime}`; includes reason when present
```

- [ ] Step 1: Tests: tokens (length 43, url-safe chars, unique; hash known vector `hashToken('abc')` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`); session (`round-trips`, `rejects tampered payload`, `rejects bad signature`, `rejects expired`, `rejects malformed/undefined`); login (`sends link for known email with 15-minute token`, `does nothing for unknown email`, `completeLogin returns account once`, `completeLogin rejects reused token`, `completeLogin rejects expired token`, `mailer failure is logged not thrown`); ics (`contains UTC DTSTART/DTEND and UID`, `uses CRLF`, `escapes commas semicolons newlines`, `folds long lines at 75 octets`); mailer (`resend sends base64 attachment`, `mailpit sends base64 attachment`, non-ASCII content base64 round-trips); templates (`approved email has ics attachment and confirmed subject`, `declined email includes escaped reason`, `login email contains link`).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: magic-link auth, session cookies, approval emails with ics`.

### Task 5: Admin service (views, decisions, validation)

**Files:** Create `src/lib/server/admin-service.ts`, `src/lib/server/admin-validation.ts`, tests for both.

**Interfaces — Produces:**

```ts
// admin-service.ts
export type AdminDataStore = BookingStore & AdminStore;
export interface AdminDeps {
	store: AdminDataStore;
	mailer: Mailer;
	appUrl: string;
}
export interface AdminBookingView extends AdminBooking {
	whenLabel: string;
	priceLabel: string;
	paid: boolean;
}
export async function listPendingRequests(
	store: AdminDataStore,
	now: Date
): Promise<AdminBookingView[]>; // pending, startsAt >= now, asc
export async function listLessons(
	store: AdminDataStore,
	opts: { range: 'upcoming' | 'past'; unpaidOnly: boolean },
	now: Date
): Promise<AdminBookingView[]>;
// approved; upcoming: startsAt >= now asc; past: startsAt < now desc
export type ActionResult = { ok: true } | { ok: false; message: string };
export async function decideRequest(
	deps: AdminDeps,
	id: string,
	decision: 'approved' | 'declined',
	reason: string,
	now: Date
): Promise<ActionResult>;
export async function setLessonPaid(
	store: AdminDataStore,
	id: string,
	paid: boolean,
	now: Date
): Promise<ActionResult>;
// admin-validation.ts — all take raw form strings, return { ok: true; value } | { ok: false; errors: Record<string, string> }
export function validateSettings(form: Record<string, string | undefined>): Result<StudioSettings>;
export function validateWeeklyHours(
	rows: { weekday: string; start: string; end: string }[]
): Result<WeeklyHours[]>;
export function validateOverride(form: {
	date: string;
	isClosed: boolean;
	note: string;
	ranges: { start: string; end: string }[];
}): Result<DateOverrideWithNote>;
export function validateLessonType(
	form: Record<string, string | undefined>
): Result<LessonTypeInput>;
export function dollarsToCents(s: string): number | null; // "35" | "35.5" | "35.50" → 3500/3550; else null
```

Decision messages (exact): `not_pending` → `This request was already handled.`; `in_past` → `This lesson time has already passed.`; `not_found` → `Booking not found.`; reason > 500 chars → `Reason must be 500 characters or fewer.` Approve sends `bookingApprovedEmail`, decline sends `bookingDeclinedEmail` (reason or null when blank), each in try/catch + `console.error`; nothing is sent when the store throws.

Validation keys/messages (exact): `timezone` → `Choose a valid time zone.` (Luxon `IANAZone.isValidZone`); `minNoticeHours` integer 0–720, `cancelCutoffHours` 0–720 → `Enter a whole number from 0 to 720.`; `maxAdvanceDays` 1–365 → `Enter a whole number from 1 to 365.`; `slotIncrementMin` ∈ {5,10,15,20,30,60} → `Choose a slot interval.`; `bufferMin` 0–120 → `Enter a whole number from 0 to 120.`; `cancellationPolicyText` ≤ 2000 → `Keep the policy under 2000 characters.`; `adminEmail` blank → null, else email regex → `Enter a valid email address.`; `allowSameDay` = form value `'on'`. Hours/overrides: time must be `HH:mm` 00:00–23:59 → `Use a time like 15:00.`; end ≤ start → `End time must be after start time.`; overlapping ranges on the same weekday/date → `Times overlap.` (key `weekday-{n}` / `ranges`); weekday 1–7; override date `yyyy-MM-dd` → `Choose a date.`; not closed and no ranges → `Add opening times or mark the day closed.`; note ≤ 200. Lesson type: `name` 1–100 → `Enter a name.` / `Keep the name under 100 characters.`; `description` ≤ 500; `durationMin` integer 5–480 → `Enter minutes from 5 to 480.`; `price` via `dollarsToCents`, 0–100000 cents → `Enter a price like 35 or 35.00.`; `sortOrder` integer (blank → 0); `active` = `'on'`.

- [ ] Step 1: Tests with `MemoryBookingStore(demoData())` + fake mailer (now = `2026-11-01T12:00` America/New_York; create bookings via `requestGuestBooking`): `lists pending requests with labels`, `approve sends confirmed email with ics`, `decline sends declined email with reason`, `decide on handled request returns message and sends nothing`, `approve in the past returns message`, `email failure does not fail decision`, `reason too long rejected`, `lists upcoming and past lessons`, `unpaid filter`, `setLessonPaid toggles`; validation: one test per message above plus a valid happy path each; `dollarsToCents` cases (`"35"`, `"35.5"`, `"35.50"`, `"$35"`→null, `"-1"`→null, `"abc"`→null, `"35.555"`→null).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: admin service and validation`.

### Task 6: Auth wiring + admin pages

**Files:** Create `src/hooks.server.ts`, `src/lib/server/admin-guard.ts` (+test), `src/routes/login/+page.server.ts`, `src/routes/login/+page.svelte`, `src/routes/login/verify/+page.server.ts`, `src/routes/login/verify/+page.svelte`, `src/routes/logout/+page.server.ts`, `src/routes/admin/+layout.server.ts`, `src/routes/admin/+layout.svelte`, `src/routes/admin/+page.server.ts` + `+page.svelte` (Requests), `src/routes/admin/lessons/…`, `src/routes/admin/settings/…`, `src/routes/admin/hours/…`, `src/routes/admin/lesson-types/…`. Modify `src/app.d.ts` (`Locals { account: Account | null }`), `src/env.ts` (`SESSION_SECRET`), `src/lib/server/context.ts` (`getStore()` returns `BookingStore & AdminStore`; `getSessionSecret()`), `.env.local.example` (SESSION_SECRET note), `src/routes/+layout.svelte` (small "Sign in"/"Admin" link).

**Interfaces:**

- `admin-guard.ts`: `adminGuard(account: Account | null): { kind: 'ok' } | { kind: 'redirect'; location: '/login' } | { kind: 'forbidden' }` — pure; tests for null, client, admin.
- `getSessionSecret(env, dev)` pure in `choose-store.ts` or a sibling (`SESSION_SECRET` → value; dev → `'dev-only-session-secret-change-me'`; else throw `SESSION_SECRET must be set`) + tests.
- `hooks.server.ts` `handle`: verify cookie → `findAccountById` → `event.locals.account`; invalid cookie → delete it.
- `/login`: form (email) → `requestLoginLink` → always render `Check your email — if that address has an account, a sign-in link is on its way.`; already signed in → admin to `/admin`, others to `/`.
- `/login/verify?token=`: GET renders "Sign in to SessionX" button (hidden token); POST → `completeLogin` → set cookie, `303` to `/admin` (admin) or `/` (others); failure → `This sign-in link is invalid or has expired.` + link to `/login`.
- `/logout`: POST clears cookie → `303 /`.
- `/admin/+layout.server.ts`: apply `adminGuard` (redirect 303 / `error(403)`), return `{ account }`. Layout nav: Requests · Lessons · Hours · Lesson types · Settings · Sign out. Every admin form action also re-checks `adminGuard(locals.account)` (actions don't run layout loads).
- Requests page: pending list (student, booker name + email, lesson, when, price, note) with Approve and Decline (optional reason textarea) per item; result message banner.
- Lessons page: tabs Upcoming / Past, "Unpaid only" toggle (query params), rows with Paid ✓ / Mark paid / Mark unpaid.
- Settings page: form for all `StudioSettings` fields (time zone as text input with datalist of common US zones), field errors via `fail(400)` with values preserved.
- Hours page: 7 weekdays, each with 0..n ranges (add/remove range rows; server-side form parsing of `weekday`/`start`/`end` arrays), Save → `replaceWeeklyHours`; overrides list (upcoming) with add form (date, closed checkbox, ranges, note) and delete.
- Lesson types page: list incl. inactive (badge), create form, edit per type (inline form or `/admin/lesson-types/[id]`).
- Plain CSS, mobile-friendly, ≥44px targets, `use:enhance`, labels + `aria-describedby` errors (match M2 style in `src/routes/book`).

- [ ] Step 1: `admin-guard.test.ts` + session-secret tests → FAIL → implement → PASS.
- [ ] Step 2: Build hooks, routes, pages.
- [ ] Step 3: `npm run check` 0/0, `npx vitest run`, `npm run lint`, `npm run build`.
- [ ] Step 4: Smoke (memory store, `npx vite dev --port 5173`, curl with `Origin: http://localhost:5173` + `Accept: text/html` on POSTs, keep a cookie jar): `/admin` → 303 `/login`; POST `/login` email `admin@sessionx.local` → 200 + generic message; read the sign-in link from the dev server's console output; GET verify → 200; POST verify → 303 `/admin` + `Set-Cookie: sx_session`; `/admin` with cookie → 200; create a guest booking via `/book/details` POST, then POST approve on `/admin` → request disappears from pending and appears on `/admin/lessons`; POST mark paid → shows Paid; POST `/admin/settings` with `timezone=Mars/Base` → 400 + `Choose a valid time zone.`; tampered cookie → `/admin` 303 `/login`; POST `/login` with `parent@example.com` then verify → `/admin` → 403.
- [ ] Step 5: Commit `feat: admin sign-in and admin pages`.

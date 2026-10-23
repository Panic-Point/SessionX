# Milestone 2 — Guest Booking Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guest can open `/book`, pick a lesson type → a day on a month calendar → an open time → enter name/email/student → submit a pending request; the booker and the teacher are emailed; the booker can view the request at a manage link.

**Architecture:** Server-only data access behind a `BookingStore` interface with two implementations: Supabase (production/local Docker) and in-memory (dev without Docker, and the reference for contract tests). Booking creation is one Postgres function (`request_guest_booking`) so find-or-create account/student + pending limit + insert is atomic. A pure `booking-service` orchestrates engine (Milestone 1 `availability.ts`, `pricing.ts`), store, and a `Mailer`. SvelteKit routes are thin.

**Tech Stack:** SvelteKit 3 / Svelte 5 runes, `@supabase/supabase-js`, Luxon, Vitest, `@electric-sql/pglite` (SQL tests without Docker), Resend REST API / Mailpit HTTP send API via `fetch` (Workers-compatible, no SMTP).

**Spec:** `docs/superpowers/specs/2026-10-23-booking-app-design.md` (sections "Key flows → Guest booking", "Pricing rule", "Data model"). Milestone 1 code: `src/lib/server/availability.ts`, `src/lib/server/pricing.ts`, `supabase/migrations/20261023000000_init.sql`.

## Global Constraints

- All DB access server-side; never import server modules into `.svelte` files or `+page.ts`. Server code lives under `src/lib/server/`.
- Guests always see and are charged the **list price** (`snapshotPriceCents({kind:'guest'}, …)`).
- Times stored/passed as UTC `Date`/ISO; displayed in `settings.timezone` with Luxon.
- Money is integer cents; display `$35.00`.
- Emails go out via `fetch` only (Cloudflare Workers runtime): Resend in prod, Mailpit locally, console fallback.
- Every user-supplied string rendered into email HTML is HTML-escaped.
- Email failure never fails a booking (log and continue).
- Run npm via Node's bundled npm: `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js"` (global npm 10.2.5 is broken). `npx vitest`, `npx prettier` work normally.
- Docker is NOT available on the dev machine; Supabase-backed code is verified by contract tests only when `SUPABASE_URL` is set (skipped otherwise).
- Copy (exact): see Task 5 messages.

## Review Focus

1. HTML/script in names or notes (`<script>`, `"><img onerror>`) → escaped in both emails and pages → Task 4 test `escapes user input in html`.
2. Two guests submit the same slot → second gets the "no longer available" message, not a 500 → Task 2 contract `rejects overlapping request` + Task 5 `maps slot_taken to friendly message`.
3. Same email with different case/whitespace (`" Parent@Example.com "`) → same account → Task 2 contract `reuses account by email case-insensitively`.
4. Tampered form: `startsAt` off the slot grid, outside hours, or in the past → rejected with the unavailable message → Task 5 `rejects start time that is not an offered slot`.
5. Email transport throws → request still succeeds → Task 5 `succeeds when email sending fails`.

---

### Task 1: `request_guest_booking` SQL function + PGlite DB check in CI

**Files:** Create `supabase/migrations/20261023010000_request_guest_booking.sql`, `supabase/tests/request_guest_booking.test.sql`, `scripts/db-check.mjs`. Modify `package.json` (devDep `@electric-sql/pglite`, script `test:db:lite`), `.github/workflows/ci.yml` (run `npm run test:db:lite`).

**Interfaces — Produces:**

```sql
request_guest_booking(
  p_email text, p_account_name text, p_student_name text,
  p_lesson_type_id uuid, p_starts_at timestamptz, p_note text
) returns table (booking_id uuid, manage_token text, price_cents integer, starts_at timestamptz, ends_at timestamptz)
-- security definer, set search_path = public; execute revoked from public, anon, authenticated; granted to service_role.
```

Behavior: email = `lower(trim(p_email))`; account found by email or created with `p_account_name` (existing account name is NOT overwritten); student found by `lower(trim(name))` within the account or created; lesson type must exist and be active else `raise exception 'lesson_type_not_found' using errcode = 'P0002'`; if the account already has ≥ 2 bookings with `status = 'pending' and starts_at > now()` → `raise exception 'too_many_pending' using errcode = 'P0001'`; `ends_at = p_starts_at + duration`, `blocked_until = ends_at + settings.buffer_min`, `price_cents = lesson_types.price_cents` (guest = list price); insert `pending`; overlap surfaces as SQLSTATE `23P01` untouched.

`scripts/db-check.mjs`: PGlite (+ `btree_gist`, `citext` contrib) with stub `auth.users` table and roles `anon`, `authenticated`, `service_role`; applies all `supabase/migrations/*.sql` in order and `supabase/seed.sql`, then runs labelled checks, prints a table, exits non-zero on any failure. (A scratch version exists at `C:\Users\awhite\sx-verify\verify-db.mjs` — port its checks: overlap rejected, back-to-back ok, cancelled frees slot, zero-length rejected, second settings row rejected.)

- [ ] Step 1: Add new checks to `db-check.mjs` and a pgTAP file covering: `creates account, student and pending booking`; `reuses account by email case-insensitively and keeps original name`; `reuses student by name case-insensitively`; `uses list price even when student has a custom price` (seed: Ben 30-min → expect 3500); `third pending request raises too_many_pending (P0001)`; `inactive lesson type raises P0002`; `overlapping request raises 23P01`; `anon cannot execute` (`has_function_privilege('anon', 'request_guest_booking(text,text,text,uuid,timestamptz,text)', 'execute')` is false).
- [ ] Step 2: `npm run test:db:lite` → FAIL (function missing).
- [ ] Step 3: Write the migration.
- [ ] Step 4: `npm run test:db:lite` → all checks ok.
- [ ] Step 5: CI step; commit `feat: request_guest_booking function and PGlite db check`.

### Task 2: `BookingStore` interface + in-memory store + contract tests

**Files:** Create `src/lib/server/store/types.ts`, `src/lib/server/store/memory.ts`, `src/lib/server/store/demo-data.ts`, `src/lib/server/store/contract.ts` (shared suite), `src/lib/server/store/memory.test.ts`.

**Interfaces — Produces (`types.ts`):**

```ts
import type { WeeklyHours, DateOverride } from '../availability';
export type BookingStatus = 'pending' | 'approved' | 'declined' | 'cancelled' | 'expired';
export interface StudioSettings { timezone: string; minNoticeHours: number; maxAdvanceDays: number; slotIncrementMin: number; bufferMin: number; allowSameDay: boolean; cancelCutoffHours: number; cancellationPolicyText: string; adminEmail: string | null }
export interface LessonType { id: string; name: string; description: string; durationMin: number; priceCents: number; sortOrder: number }
export interface LiveBooking { startsAt: Date; endsAt: Date; blockedUntil: Date }  // pending or approved
export interface GuestBookingInput { email: string; accountName: string; studentName: string; lessonTypeId: string; startsAt: Date; note: string }
export interface CreatedBooking { bookingId: string; manageToken: string; priceCents: number; startsAt: Date; endsAt: Date }
export type BookingStoreErrorCode = 'slot_taken' | 'too_many_pending' | 'lesson_type_not_found';
export class BookingStoreError extends Error { constructor(public readonly code: BookingStoreErrorCode) }
export interface BookingSummary { status: BookingStatus; startsAt: Date; endsAt: Date; lessonTypeName: string; studentName: string; accountName: string; priceCents: number; note: string }
export interface BookingStore {
  getSettings(): Promise<StudioSettings>;
  getWeeklyHours(): Promise<WeeklyHours[]>;
  getDateOverrides(fromDate: string, toDate: string): Promise<DateOverride[]>;   // inclusive yyyy-MM-dd
  getActiveLessonTypes(): Promise<LessonType[]>;                                 // sorted by sortOrder
  getLiveBookings(from: Date, to: Date): Promise<LiveBooking[]>;                 // overlapping [from, to)
  requestGuestBooking(input: GuestBookingInput, now: Date): Promise<CreatedBooking>; // throws BookingStoreError
  getBookingByManageToken(token: string): Promise<BookingSummary | null>;
}
```

`contract.ts` exports `runBookingStoreContract(name: string, makeStore: () => Promise<BookingStore>)` — a `describe` block every implementation runs. `memory.ts` exports `class MemoryBookingStore implements BookingStore` with constructor `(data?: DemoData)`; `demo-data.ts` exports `demoData()` mirroring `supabase/seed.sql` exactly (same IDs, hours, lesson types, Ava/Ben, Ben's $30 custom price). Memory semantics must match Task 1's SQL function exactly (email normalization, name not overwritten, student match, pending limit counts `pending` with `startsAt > now`, overlap uses `[startsAt, blockedUntil)` vs live bookings, list price).

- [ ] Step 1: Contract tests: `returns seeded settings`, `returns active lesson types in order`, `creates a pending booking at list price` (Ben 30-min → 3500), `reuses account by email case-insensitively`, `rejects overlapping request` (code `slot_taken`), `allows back-to-back request`, `third pending request is rejected` (`too_many_pending`), `unknown lesson type is rejected` (`lesson_type_not_found`), `live bookings include the new pending booking`, `finds booking by manage token`, `unknown manage token returns null`, `date overrides filtered to range`.
- [ ] Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.
- [ ] Step 5: Commit `feat: booking store interface and in-memory store`.

### Task 3: Supabase store

**Files:** Create `src/lib/server/store/supabase.ts`, `src/lib/server/store/supabase-mappers.ts`, `src/lib/server/store/supabase-mappers.test.ts`, `src/lib/server/store/supabase.test.ts`. Modify `package.json` (dep `@supabase/supabase-js`).

**Interfaces:** Consumes Task 1 function and Task 2 types. Produces `createSupabaseBookingStore(url: string, serviceRoleKey: string): BookingStore` and pure mappers `mapSettingsRow`, `mapWeeklyHoursRow` (`'15:00:00'` → `'15:00'`), `mapOverrides(overrideRows, rangeRows): DateOverride[]`, `mapLessonTypeRow`, `mapLiveBookingRow`, `mapRpcError(error: {code?: string; message?: string}): BookingStoreError | null` (`23P01`→`slot_taken`, `P0001`→`too_many_pending`, `P0002`→`lesson_type_not_found`).

- [ ] Step 1: Mapper unit tests (time trimming, override grouping incl. closed day with no ranges, each error code, unknown code → null). `supabase.test.ts` runs `runBookingStoreContract` only when `process.env.SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set (`describe.skipIf`), resetting with `npx supabase db reset` is NOT done by the test — document that it expects a freshly seeded DB.
- [ ] Step 2: Run → mapper tests FAIL. Step 3: Implement (client created with `{ auth: { persistSession: false } }`; `rpc('request_guest_booking', …)` returns an array — take `[0]`). Step 4: Run → PASS (contract suite reports skipped).
- [ ] Step 5: Commit `feat: Supabase booking store`.

### Task 4: Mailer + email templates

**Files:** Create `src/lib/server/email/mailer.ts`, `src/lib/server/email/templates.ts`, `src/lib/server/format.ts`, tests `mailer.test.ts`, `templates.test.ts`, `format.test.ts`.

**Interfaces — Produces:**

```ts
// format.ts
export function formatMoney(cents: number): string; // 3500 → "$35.00"
export function formatDateTime(at: Date, timezone: string): string; // "Monday, November 2, 2026 at 3:00 PM EST"
export function formatTime(at: Date, timezone: string): string; // "3:00 PM"
export function escapeHtml(s: string): string;
// mailer.ts
export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html: string;
}
export interface Mailer {
	send(msg: EmailMessage): Promise<void>;
}
export interface MailerEnv {
	EMAIL_TRANSPORT?: string;
	RESEND_API_KEY?: string;
	MAILPIT_URL?: string;
	EMAIL_FROM?: string;
}
export function createMailer(env: MailerEnv, fetchFn?: typeof fetch): Mailer;
// templates.ts
export interface BookingEmailData {
	accountName: string;
	email: string;
	studentName: string;
	lessonTypeName: string;
	durationMin: number;
	startsAt: Date;
	timezone: string;
	priceCents: number;
	note: string;
	manageUrl: string;
}
export function requestReceivedEmail(d: BookingEmailData): EmailMessage; // to d.email
export function newRequestEmail(d: BookingEmailData, adminEmail: string): EmailMessage;
```

Transports: `resend` → `POST https://api.resend.com/emails` with `Authorization: Bearer RESEND_API_KEY`, body `{from, to: [to], subject, text, html}`; `mailpit` → `POST ${MAILPIT_URL}/api/v1/send` body `{From: {Email, Name}, To: [{Email}], Subject, Text, HTML}` (parse `EMAIL_FROM` `"Name <addr>"`); `console` (default) → `console.info`. Non-2xx → throw `Error` including status.

Subjects (exact): received → `Lesson request received – {lessonTypeName} on {formatDateTime}`; teacher → `New lesson request: {studentName}, {formatDateTime}`.

- [ ] Step 1: Tests: format cases (incl. `formatDateTime` on 2026-03-08 afternoon shows `EDT`); `resend transport posts expected request` (fake fetch captures url/headers/body); `mailpit transport posts expected request`; `non-2xx response throws`; `defaults to console transport`; templates: `received email goes to booker and includes manage link, time, price`; `teacher email includes booker contact and note`; `escapes user input in html` (studentName `<script>x</script>` → html contains `&lt;script&gt;`, not `<script>`); text part has no HTML tags.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: mailer and booking emails`.

### Task 5: Booking service

**Files:** Create `src/lib/server/booking-service.ts`, `src/lib/server/booking-service.test.ts`.

**Interfaces — Consumes:** Task 2 `BookingStore` (tests use `MemoryBookingStore` + `demoData()`), Task 4 `Mailer`/templates, M1 `getAvailableSlots`, `snapshotPriceCents`. **Produces:**

```ts
export interface LessonTypeView {
	id: string;
	name: string;
	description: string;
	durationMin: number;
	priceLabel: string;
}
export async function listLessonTypes(store: BookingStore): Promise<LessonTypeView[]>; // guest prices
export interface MonthAvailability {
	timezone: string;
	month: string;
	lessonType: LessonTypeView;
	days: Record<string, { iso: string; label: string }[]>;
}
export async function getMonthAvailability(
	store: BookingStore,
	lessonTypeId: string,
	month: string /* yyyy-MM */,
	now: Date
): Promise<MonthAvailability | null>; // null if type unknown or month malformed
export interface GuestRequestForm {
	lessonTypeId: string;
	startsAt: string;
	accountName: string;
	email: string;
	studentName: string;
	note: string;
}
export type FormField = 'accountName' | 'email' | 'studentName' | 'note' | 'startsAt';
export type SubmitResult =
	{ ok: true; manageToken: string } | { ok: false; errors: Partial<Record<FormField, string>> };
export interface ServiceDeps {
	store: BookingStore;
	mailer: Mailer;
	appUrl: string;
}
export async function submitGuestRequest(
	deps: ServiceDeps,
	form: GuestRequestForm,
	now: Date
): Promise<SubmitResult>;
export async function getManageView(
	store: BookingStore,
	token: string
): Promise<(BookingSummary & { timezone: string; whenLabel: string; priceLabel: string }) | null>;
```

`getMonthAvailability` loads settings, hours, overrides for the month, live bookings for `[monthStart − 1 day, monthEnd + 1 day)` mapped to `Interval {start, end, blockedUntil}`, and calls `getAvailableSlots`; labels via `formatTime`. `submitGuestRequest`: trims fields; validates; re-checks that `startsAt` is exactly one of the offered slots for that date (recompute with the engine); calls `store.requestGuestBooking`; sends `requestReceivedEmail` to booker and `newRequestEmail` to `settings.adminEmail` (skip if null), each in its own try/catch with `console.error`; `manageUrl = ${appUrl}/manage/${token}`.

Messages (exact):

- accountName empty → `Please enter your name.`
- email invalid (not `^[^\s@]+@[^\s@]+\.[^\s@]+$`) → `Please enter a valid email address.`
- studentName empty → `Please enter who the lesson is for.`
- note > 1000 chars → `Notes must be 1000 characters or fewer.`
- slot not offered or `slot_taken` → `startsAt: Sorry, that time is no longer available. Please pick another.`
- `too_many_pending` → `email: You already have 2 lesson requests waiting for approval. Please wait for a reply before requesting more.`
- `lesson_type_not_found` → `startsAt: That lesson type is no longer available.`

- [ ] Step 1: Tests (now = `2026-11-01T12:00` America/New_York; memory store with demo data): `lists lesson types with guest prices` (`$35.00`, `$50.00`, `$65.00`); `month availability marks Monday slots` (2026-11-02 first label `3:00 PM`); `month availability excludes an existing pending booking's slot`; `unknown lesson type returns null`; `malformed month returns null`; `valid request creates booking and returns token`; `sends received email to booker and new-request email to admin` (fake mailer records messages); `required field errors` (each message); `rejects start time that is not an offered slot` (e.g. 2026-11-02T20:10Z, a Sunday time, a past time); `maps slot_taken to friendly message` (submit same slot twice); `maps too_many_pending to email error`; `succeeds when email sending fails` (mailer throws); `manage view shows status and formatted time`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: guest booking service`.

### Task 6: Booking UI (Calendly-style) + wiring

**Files:** Create `src/lib/server/context.ts`, `src/routes/book/+page.server.ts`, `src/routes/book/+page.svelte`, `src/routes/book/details/+page.server.ts`, `src/routes/book/details/+page.svelte`, `src/routes/book/requested/+page.svelte`, `src/routes/manage/[token]/+page.server.ts`, `src/routes/manage/[token]/+page.svelte`, `src/lib/components/MonthCalendar.svelte`, `src/lib/components/TimeList.svelte`, `src/lib/components/month.ts` + `month.test.ts`. Modify `src/routes/+page.svelte` (landing: studio name + "Book a lesson" → `/book`), `src/routes/+layout.svelte` (base styles, mobile viewport), `.env.local.example` (new vars).

**Interfaces:**

- `context.ts`: `getStore(): BookingStore` (env `BOOKING_STORE=memory` → a module-level `MemoryBookingStore(demoData())` singleton; else Supabase from `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; default `memory` when `SUPABASE_URL` unset), `getMailer(): Mailer`, `getAppUrl(): string` (`PUBLIC_APP_URL` or request origin). Read env via `$env/dynamic/private`.
- `month.ts` (pure, tested): `monthGrid(month: string /* yyyy-MM */): (string | null)[][]` — weeks Sun→Sat, `null` padding; `shiftMonth(month: string, delta: number): string`. Tests: Nov 2026 grid first row `[null×0 … ]` starts Sunday `2026-11-01`; Feb 2026 has 4 rows; `shiftMonth('2026-12', 1) === '2027-01'`.
- `/book?type=&month=&date=`: step 1 (no `type`) lists lesson types as cards (name, length, price) linking to `?type=ID`. With `type`: header shows chosen type + "Change"; two-pane on ≥ 768px (calendar left, times right), stacked on mobile; `MonthCalendar` shows prev/next month links (prev hidden for months before the current), days with slots are bold buttons, others greyed/disabled, selected day highlighted; `TimeList` shows that day's times as buttons linking to `/book/details?type=&start=ISO`; timezone label (e.g. "Times shown in Eastern Time"). Default `month` = current month in studio tz; default `date` = first day with slots.
- `/book/details?type=&start=`: summary (type, `formatDateTime`, price) + form (Your name, Email, Student's name — hint "Who is the lesson for? Use your own name if it's for you.", Note optional) → `actions.default` calls `submitGuestRequest`; errors re-render with values preserved via `fail(400, …)`; success `redirect(303, '/book/requested?token=…')`. If the slot is no longer offered at load, show the unavailable message with a link back to the calendar.
- `/book/requested`: "Request sent!" + what happens next ("You'll get an email when it's approved") + link to `/manage/{token}`.
- `/manage/[token]`: status badge (Pending approval / Approved / Declined / Cancelled / Expired), lesson, student, time, price; 404 if not found.
- Use progressive enhancement (`use:enhance`) and plain CSS in components (no UI framework). Mobile-first, tap targets ≥ 44px.

- [ ] Step 1: Write `month.test.ts` → FAIL → implement `month.ts` → PASS.
- [ ] Step 2: Build routes/components.
- [ ] Step 3: `npm run check` → 0 errors; `npx vitest run` → all pass; `npm run build` → success.
- [ ] Step 4: Smoke run with the memory store: `npm run dev` (with `BOOKING_STORE=memory`), then `curl` `/book` (200, contains lesson names), `/book?type=11111111-0000-0000-0000-000000000030` (200, contains a time label), POST the details form for an offered slot (303 to `/book/requested`), GET `/manage/{token}` (200, "Pending approval").
- [ ] Step 5: Commit `feat: Calendly-style guest booking pages`.

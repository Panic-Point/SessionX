# Milestone 4 — Families, Custom Prices, Cancellations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in family sees its lessons at `/account`, manages its students, books for a chosen student at that student's own price, and cancels lessons (late cancellations warned + teacher emailed). Guests can cancel from their manage link. The teacher sets per-student prices and notes under `/admin/families` and sees late cancellations on the Lessons page.

**Architecture:** A third store interface, `AccountStore`, implemented by the same memory class and Supabase store object (`AppStore = BookingStore & AdminStore & AccountStore`), with a shared contract suite. Account bookings go through a new atomic Postgres function `request_account_booking`; cancellations through `cancel_booking`. Logic lives in `account-service.ts` and additions to `booking-service.ts` / `admin-service.ts`; routes stay thin. Sign-in reuses Milestone 3's magic links (any existing account can already sign in).

**Tech Stack:** SvelteKit 3.1 / Svelte 5 runes, `@supabase/supabase-js`, Luxon, Vitest, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-23-booking-app-design.md` (Goals 9, 10; "Accounts and students"; "Pricing rule"; "Key flows → Signed-in booking, Cancel"; "Admin screens → Accounts & Students"). Prior plans: `docs/superpowers/plans/2026-10-23-milestone-2-guest-booking.md`, `docs/superpowers/plans/2026-10-23-milestone-3-admin.md`.

## Global Constraints

- All DB access server-side; never import `$lib/server`/`#lib/server` into `.svelte`/`+page.ts`. In SvelteKit 3, `dev` comes from `$app/env`.
- **Guards in every load and action** (kit 3.1 serializes leaf data even when a layout errors, and `__data.json?x-sveltekit-invalidated=…` skips layouts): every `/account/**` load and action calls `requireAccount(locals.account)` (anonymous → `303 /login`); every `/admin/**` load and action keeps calling `requireAdmin`.
- **Ownership:** an account can see, book for, rename, or cancel only its own students/bookings. A booking or student id from another account behaves exactly like a nonexistent id (`404` / `not_found`), with no side effects.
- **Prices:** guests see list prices; a signed-in account sees its own student's custom price (`displayPriceCents({kind:'account', accountId}, …)`); nobody sees another family's custom price. Account bookings snapshot `coalesce(custom, list)`.
- **Manage-link pages never show the stored account name or email** (Milestone 2 fix — token holders haven't proven they own the email).
- **Late cancellation:** `late = booking.status === 'approved' && startsAt − now < cancelCutoffHours` (strictly less; exactly at the cutoff is not late). Pending requests are never late (_controller ruling: they were never confirmed_). Late cancels are still cancelled and free the slot.
- Only `pending`/`approved` bookings with `startsAt > now` are cancellable.
- Every cancellation emails the booker (confirmation) and the teacher (notice; "late" variant when late). The teacher's new-request email now links to `${appUrl}/admin` instead of the guest manage link (closes the Milestone 2/3 ruling).
- Email failures never fail an action; user text escaped in HTML.
- Times UTC in storage, shown in `settings.timezone`; money integer cents; admin price inputs in dollars via `dollarsToCents`.
- npm installs: `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" …`. Docker unavailable: SQL verified in PGlite; Supabase contract suites skip without `SUPABASE_URL`.

## Review Focus

1. Account A opens or cancels account B's booking (`/account/cancel/{B-id}`) or renames B's student → 404 / `not_found`, nothing changes, no email → Task 2 contract `cannot cancel another account's booking`, `cannot rename another account's student`; Task 6 smoke.
2. Tampered `studentId` from another account on signed-in booking → rejected, no booking → Task 1 db-check `student from another account raises P0003`, Task 2 contract, Task 4 `rejects student from another account`.
3. Custom prices: guest and other accounts see list price; owner sees custom in `/book` and on the details summary; booking snapshots custom → Task 1 db-check `uses custom price`, Task 4 pricing tests, Task 6 smoke.
4. Cancelling an already cancelled / declined / past booking → `This lesson can no longer be cancelled online.`, no email → Task 2 contract `not_cancellable`, Task 4 `cancel on handled booking sends nothing`.
5. Late boundary: exactly `cutoff` hours before → not late; one minute inside → late; pending inside cutoff → not late → Task 4 late tests.

---

### Task 1: SQL — account booking, cancellation, unique student names

**Files:** Create `supabase/migrations/20261026000000_families.sql`, `supabase/tests/families.test.sql`. Modify `scripts/db-check.mjs`.

**Interfaces — Produces:**

```sql
create unique index students_account_name_key on students (account_id, lower(btrim(name)));
request_account_booking(p_account_id uuid, p_student_id uuid, p_lesson_type_id uuid, p_starts_at timestamptz, p_note text)
  returns table (booking_id uuid, manage_token text, price_cents integer, starts_at timestamptz, ends_at timestamptz)
  -- student must belong to account else raise 'student_not_found' using errcode 'P0003'
  -- lesson type active else 'lesson_type_not_found' P0002; ≥2 future pending for the account → 'too_many_pending' P0001
  -- price = coalesce(student_prices.price_cents, lesson_types.price_cents); ends_at/blocked_until as request_guest_booking; overlap 23P01
cancel_booking(p_booking_id uuid, p_account_id uuid, p_manage_token text, p_late boolean, p_now timestamptz) returns uuid
  -- target = (p_booking_id AND booking's student belongs to p_account_id) OR (p_manage_token matches); exactly one target style is non-null
  -- no matching booking → 'booking_not_found' P0004; status not in (pending, approved) or starts_at <= p_now → 'not_cancellable' P0005
  -- sets status='cancelled', cancelled_at=p_now, late_cancel=p_late; returns booking id
-- both: security definer, set search_path = public, execute revoked from public/anon/authenticated, granted to service_role; no DELETE/UPDATE without WHERE (db-check guard)
```

- [ ] Step 1: db-check checks (+ pgTAP): `duplicate student name in same account rejected (23505)`, `same name in different accounts allowed`, `account booking uses custom price` (Ben 30-min → 3000), `account booking uses list price without custom` (Ava 30-min → 3500), `student from another account raises P0003`, `account booking pending limit P0001`, `account booking overlap 23P01`, `cancel by account frees slot and sets late_cancel`, `cancel another account's booking raises P0004`, `cancel by manage token`, `cancel already-cancelled raises P0005`, `cancel past booking raises P0005`, `anon cannot execute either function`.
- [ ] Step 2: `npm run test:db:lite` → new checks FAIL. Step 3: migration. Step 4: all ok.
- [ ] Step 5: Commit `feat: account booking and cancellation functions`.

### Task 2: `AccountStore` interface + memory + contract

**Files:** Modify `src/lib/server/store/types.ts`, `src/lib/server/store/memory.ts`. Create `src/lib/server/store/account-contract.ts`, `src/lib/server/store/memory-account.test.ts`.

**Interfaces — Produces (`types.ts`):**

```ts
export interface Student { id: string; accountId: string; name: string; notes: string }
export interface StudentPrice { studentId: string; lessonTypeId: string; priceCents: number }
export interface AccountBookingInput { accountId: string; studentId: string; lessonTypeId: string; startsAt: Date; note: string }
export interface AccountWithStudents extends Account { adminNotes: string; students: (Student & { prices: StudentPrice[] })[] }
export type CancelTarget = { kind: 'account'; bookingId: string; accountId: string } | { kind: 'token'; manageToken: string };
export type AccountStoreErrorCode = 'not_found' | 'duplicate_student' | 'not_cancellable';
export class AccountStoreError extends Error { constructor(public readonly code: AccountStoreErrorCode) }
// BookingFilter gains: lateCancelOnly?: boolean
export interface AccountStore {
  listStudents(accountId: string): Promise<Student[]>;                                   // by name
  addStudent(accountId: string, name: string): Promise<Student>;                         // trims; duplicate_student (case-insensitive)
  renameStudent(accountId: string, studentId: string, name: string): Promise<Student>;   // not_found if not this account's; duplicate_student
  listStudentPrices(studentIds: string[]): Promise<StudentPrice[]>;
  listAccountBookings(accountId: string): Promise<AdminBooking[]>;                       // all statuses, all the account's students, startsAt desc
  requestAccountBooking(input: AccountBookingInput, now: Date): Promise<CreatedBooking>;
    // BookingStoreError slot_taken | too_many_pending | lesson_type_not_found; AccountStoreError not_found (student not in account)
  getBookingByTarget(target: CancelTarget): Promise<AdminBooking | null>;               // null for other account's booking
  cancelBooking(target: CancelTarget, lateCancel: boolean, now: Date): Promise<AdminBooking>;  // not_found | not_cancellable
  listAccounts(): Promise<AccountWithStudents[]>;                                        // by name
  getAccount(accountId: string): Promise<AccountWithStudents | null>;
  setStudentPrice(studentId: string, lessonTypeId: string, priceCents: number | null): Promise<void>;  // null removes; not_found
  updateAccountNotes(accountId: string, notes: string): Promise<void>;                   // not_found
  updateStudentNotes(studentId: string, notes: string): Promise<void>;                   // not_found
}
export type AppStore = BookingStore & AdminStore & AccountStore;
```

Memory semantics mirror Task 1 exactly (same error order as the SQL: student ownership → lesson type → pending limit → overlap; rejected requests mutate nothing). `listBookings` honours `lateCancelOnly`. `account-contract.ts` exports `runAccountStoreContract(name, makeStore: () => Promise<AppStore>, reset?)`.

- [ ] Step 1: Contract tests (2030 dates, seeded Pat Parent account `22222222-0000-0000-0000-00000000000b` with Ava/Ben; create a second account via `requestGuestBooking` with another email): `lists students by name`, `adds a student`, `rejects duplicate student name case-insensitively`, `renames own student`, `cannot rename another account's student`, `account booking uses custom price`, `account booking uses list price without custom`, `rejects student from another account`, `account booking pending limit`, `lists account bookings across students newest first`, `cancels own booking and frees the slot`, `cancel records late flag`, `cannot cancel another account's booking`, `cancel by manage token`, `cancelling a cancelled booking is not_cancellable`, `cancelling a past booking is not_cancellable`, `lists accounts with students and prices`, `setStudentPrice sets and clears`, `updates account and student notes`, `lateCancelOnly filter`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS (all existing suites too).
- [ ] Step 5: Commit `feat: account store interface and in-memory implementation`.

### Task 3: Supabase `AccountStore`

**Files:** Modify `src/lib/server/store/supabase.ts`, `supabase-mappers.ts` (+test), `supabase.test.ts`.

**Interfaces:** `createSupabaseBookingStore` returns `AppStore`. RPC errors: extend `mapRpcError`-style mapping — `P0003`/`P0004` → `AccountStoreError('not_found')`, `P0005` → `AccountStoreError('not_cancellable')`, `23505` on students → `duplicate_student`. `listAccountBookings` filters through `students!inner(account_id)`; `getBookingByTarget` for `kind:'account'` must also check ownership (embed filter) and return null otherwise. Run `runAccountStoreContract` in `supabase.test.ts` (skipped without env); extend the reset hook to delete non-seed students' prices and restore seed `student_prices`. Malformed UUIDs in ids → treat as not found (map `22P02` → `null` / `not_found`) for the new methods.

- [ ] Step 1: Mapper/error-mapping tests (each code above, unknown code → null, `22P02` handling, account-with-students grouping with prices).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS (contract skipped). `npm run build` ok.
- [ ] Step 5: Commit `feat: Supabase account store`.

### Task 4: Account + signed-in booking services, cancellation emails

**Files:** Create `src/lib/server/account-service.ts` (+test). Modify `src/lib/server/booking-service.ts` (+test), `src/lib/server/email/templates.ts` (+test), `src/lib/server/admin-service.ts` (type alias only: `AdminDataStore` = `AppStore`).

**Interfaces — Produces:**

```ts
// templates.ts
export function newRequestEmail(
	d: BookingEmailData,
	adminEmail: string,
	adminUrl?: string
): EmailMessage; // link = adminUrl ?? d.manageUrl
export function cancellationConfirmationEmail(d: BookingEmailData): EmailMessage;
// to d.email; subject `Lesson cancelled – {lessonTypeName} on {formatDateTime}`
export function cancellationNoticeEmail(
	d: BookingEmailData,
	adminEmail: string,
	adminUrl: string,
	late: boolean,
	cutoffHours: number
): EmailMessage;
// subject late ? `Late cancellation: {studentName}, {formatDateTime}` : `Lesson cancelled: {studentName}, {formatDateTime}`
// late body includes `This cancellation is less than {cutoffHours} hours before the lesson.`
// booking-service.ts (existing guest functions keep their signatures; submitGuestRequest passes `${appUrl}/admin` to newRequestEmail)
export interface StudentChoice {
	accountId: string;
	studentId: string;
}
export async function listLessonTypesFor(
	store: AppStore,
	student: StudentChoice | null
): Promise<LessonTypeView[] | null>; // null if student not this account's
export async function getMonthAvailability(
	store,
	lessonTypeId,
	month,
	now,
	student?: StudentChoice
): Promise<MonthAvailability | null>; // lessonType.priceLabel uses the student's price when given
export interface AccountRequestForm {
	lessonTypeId: string;
	startsAt: string;
	studentId: string;
	note: string;
}
export async function submitAccountRequest(
	deps: ServiceDeps & { store: AppStore },
	accountId: string,
	form: AccountRequestForm,
	now: Date
): Promise<SubmitResult>;
// FormField gains 'studentId'; student not this account's → { studentId: 'Choose who the lesson is for.' }; other messages as M2
// emails: requestReceivedEmail to the account's email, newRequestEmail to admin with `${appUrl}/admin`
// account-service.ts
export interface AccountBookingView {
	id: string;
	status: BookingStatus;
	statusLabel: string;
	whenLabel: string;
	lessonTypeName: string;
	studentName: string;
	priceLabel: string;
	lateCancel: boolean;
	canCancel: boolean;
}
export async function getAccountHome(
	store: AppStore,
	accountId: string,
	now: Date
): Promise<{ students: Student[]; upcoming: AccountBookingView[]; past: AccountBookingView[] }>;
// upcoming: status pending|approved and startsAt >= now, asc; past: everything else, desc
export type FieldResult = { ok: true } | { ok: false; errors: Record<string, string> };
export async function addMyStudent(
	store: AppStore,
	accountId: string,
	name: string
): Promise<FieldResult>;
export async function renameMyStudent(
	store: AppStore,
	accountId: string,
	studentId: string,
	name: string
): Promise<FieldResult>;
export interface CancelView {
	booking: AccountBookingView & { durationMin: number };
	late: boolean;
	cutoffHours: number;
	policyText: string;
}
export async function getCancelView(
	store: AppStore,
	target: CancelTarget,
	now: Date
): Promise<CancelView | null>; // never includes account name/email
export function isLateCancel(
	status: BookingStatus,
	startsAt: Date,
	now: Date,
	cutoffHours: number
): boolean;
export async function cancelLesson(
	deps: ServiceDeps & { store: AppStore },
	target: CancelTarget,
	now: Date
): Promise<{ ok: true; late: boolean } | { ok: false; message: string }>;
```

Status labels (exact): pending `Pending approval`, approved `Confirmed`, declined `Declined`, cancelled `Cancelled`, expired `Expired`. Student name messages (key `name`): empty `Enter a name.`, > 100 `Keep the name under 100 characters.`, duplicate `You already have a student with that name.`; rename of non-owned → `Student not found.` (key `name`). Cancel messages: `not_found` → `Booking not found.`, `not_cancellable` → `This lesson can no longer be cancelled online.` Late warning copy (used by the route, exported const `LATE_CANCEL_WARNING(cutoffHours)`): `This is less than {cutoffHours} hours before your lesson, so it falls outside our cancellation policy and you may still be charged.`

- [ ] Step 1: Tests (memory store + fake mailer; now `2026-11-01T12:00` America/New_York; seed cutoff 24h): templates (subjects, escaped names, late sentence present only when late, new-request link uses adminUrl); `isLateCancel` (exactly 24h → false, 23h59m → true, pending inside cutoff → false, approved outside → false); `lists lesson types with the student's custom price` (Ben 30-min `$30.00`, Ava `$35.00`); `returns null for another account's student`; `month availability uses student price`; `submits account request at custom price`; `rejects student from another account`; `account request emails account and admin with admin link`; `account home splits upcoming and past`; student add/rename messages; `cancel view marks late`; `cancel view hides account name and email`; `cancel sends confirmation and late notice`; `cancel on handled booking sends nothing`; `cannot cancel another account's booking`; `email failure does not fail cancellation`; `guest new-request email links to admin`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: account services, signed-in booking, cancellation emails`.

### Task 5: Admin families + late-cancel lessons (service)

**Files:** Modify `src/lib/server/admin-service.ts` (+test).

**Interfaces — Produces:**

```ts
export interface FamilyListItem {
	id: string;
	name: string;
	email: string;
	studentNames: string[];
}
export async function listFamilies(store: AppStore): Promise<FamilyListItem[]>; // role 'client' only, by name
export interface FamilyView {
	id: string;
	name: string;
	email: string;
	adminNotes: string;
	students: {
		id: string;
		name: string;
		notes: string;
		prices: {
			lessonTypeId: string;
			lessonTypeName: string;
			listPriceLabel: string;
			customPrice: string; /* dollars like "30.00", '' when none */
		}[];
	}[];
}
export async function getFamily(store: AppStore, accountId: string): Promise<FamilyView | null>; // all lesson types incl. inactive, by sortOrder
export async function saveStudentPrices(
	store: AppStore,
	studentId: string,
	form: Record<string, string>
): Promise<Result<null>>;
// keys = lessonTypeIds; '' → clear; invalid → errors[lessonTypeId] = 'Enter a price like 35 or 35.00.'; nothing saved if any error
export async function saveAccountNotes(
	store: AppStore,
	accountId: string,
	notes: string
): Promise<Result<null>>; // ≤ 2000 → 'Keep notes under 2000 characters.'
export async function saveStudentNotes(
	store: AppStore,
	studentId: string,
	notes: string
): Promise<Result<null>>;
// listLessons opts.range gains 'late-cancels': cancelled + lateCancel, startsAt desc
```

- [ ] Step 1: Tests: `lists families without the admin`, `family view shows custom and blank prices`, `saves and clears student prices`, `invalid price saves nothing`, notes length, `late-cancels range lists only late cancellations`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: admin families and late-cancel lessons`.

### Task 6: Family routes (account, signed-in booking, cancel)

**Files:** Create `src/lib/server/account-guard.ts` (+test: `requireAccount`), `src/routes/account/+page.server.ts`, `+page.svelte`, `src/routes/account/cancel/[id]/+page.server.ts`, `+page.svelte`, `src/routes/manage/[token]/cancel/+page.server.ts`, `+page.svelte`. Modify `src/routes/book/+page.server.ts`, `+page.svelte`, `src/routes/book/details/+page.server.ts`, `+page.svelte`, `src/routes/manage/[token]/+page.svelte` (+server if needed), `src/routes/login/verify/+page.server.ts` (client → `/account`), `src/routes/login/+page.server.ts` (already signed-in client → `/account`), `src/routes/+layout.svelte` (signed-in client: "My lessons" link; sign out).

**Interfaces / behaviour:**

- `requireAccount(account: Account | null): Account` — throws `redirect(303, '/login')` when null. Called first in every `/account/**` load and action.
- `/account`: "Book a lesson" button → `/book`; **Students** (list, add form, rename inline; field errors); **Upcoming lessons** (student, lesson, when, price, status label; "Cancel" link → `/account/cancel/{id}` when `canCancel`); **Past lessons**; banner `Lesson cancelled.` after `?cancelled=1`.
- `/account/cancel/[id]`: load `getCancelView({kind:'account', bookingId, accountId})` → 404 when null; shows lesson details, late warning (`LATE_CANCEL_WARNING`) + policy text when late, "Cancel lesson" button; action `cancelLesson` → `303 /account?cancelled=1`, or message on failure.
- `/manage/[token]`: show "Cancel this lesson" link → `/manage/{token}/cancel` when cancellable. `/manage/[token]/cancel`: same confirm page with `{kind:'token'}` → on success `303 /manage/{token}`. No account name/email anywhere on manage pages.
- `/book` when signed in: no `student` param → step "Who is this lesson for?" listing the account's students as links (`?student={id}`) + inline "Add a student" form (action → `303 /book?student={new id}`). With `student`: lesson types via `listLessonTypesFor` (404/redirect to `/book` when not this account's), calendar/times links carry `student`. Guests: unchanged flow.
- `/book/details` when signed in (`student` param required): summary shows the student's price; form has only Note; action `submitAccountRequest` → `303 /book/requested?token=…`. Guests unchanged.
- Admin users who visit `/book` while signed in book as an account too (same code path).
- Match the existing CSS/form/a11y style (`src/routes/book`, `src/routes/admin`).

- [ ] Step 1: `account-guard.test.ts` → FAIL → implement → PASS.
- [ ] Step 2: Build routes. Step 3: `npm run check` 0/0, `npx vitest run`, `npm run lint`, `npm run build`.
- [ ] Step 4: Smoke (memory store; cookie jars; POSTs with `Origin` + `Accept: text/html`; sign in via console-printed magic links): parent@example.com → `/account` 200 lists Ava and Ben; `/book` shows student picker; `/book?student=<Ben>&type=…030` shows `$30.00`, Ava shows `$35.00`, guest shows `$35.00`; book for Ben → requested; `/account` lists it Pending; cancel it → `/account?cancelled=1`, console shows confirmation + notice emails; second account (sign in after a guest booking with another email) → `/account/cancel/{Pat's booking id}` 404 and `/account/__data.json?x-sveltekit-invalidated=01` shows only its own data; anonymous `/account` → 303 `/login`; guest manage link → cancel → status Cancelled, page has no account name/email.
- [ ] Step 5: Commit `feat: family account pages, signed-in booking, cancellations`.

### Task 7: Admin families pages + late-cancel tab

**Files:** Create `src/routes/admin/families/+page.server.ts`, `+page.svelte`, `src/routes/admin/families/[id]/+page.server.ts`, `+page.svelte`. Modify `src/routes/admin/+layout.svelte` (nav: add "Families"), `src/routes/admin/lessons/+page.server.ts` + `+page.svelte` (tab "Late cancels"), `src/routes/admin/admin-loads.test.ts` (new loads covered).

**Behaviour:** every load/action calls `requireAdmin` first. Families list (name, email, students). Family page: account notes form; per student: notes form and a price table (lesson type, list price, custom price input — blank = list price) with one Save per student → `saveStudentPrices`; field errors keyed by lesson type id; values preserved on error. Lessons "Late cancels" tab lists `range: 'late-cancels'` with Mark paid / unpaid.

- [ ] Step 1: Extend `admin-loads.test.ts` (anonymous → redirect, client → 403 for both new loads) → FAIL → implement → PASS.
- [ ] Step 2: Build pages. Step 3: check/test/lint/build.
- [ ] Step 4: Smoke as admin: `/admin/families` lists Pat Parent; set Ava 30-min to `32` → family page shows `32.00`; `/book` as parent for Ava shows `$32.00`; invalid `abc` → 400 + message, nothing saved; late-cancel an approved lesson as parent (approve it first, with seed cutoff 24h and a slot inside 24h — or temporarily set cutoff to 720 in `/admin/settings`) → appears under Late cancels; parent `/admin/families/__data.json?x-sveltekit-invalidated=001` → no data.
- [ ] Step 5: Commit `feat: admin families pages and late-cancel tab`.

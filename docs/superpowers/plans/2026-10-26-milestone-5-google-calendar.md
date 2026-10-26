# Milestone 5 — Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approved lessons appear on the teacher's Google Calendar automatically and disappear when cancelled; busy time on the teacher's chosen Google calendars hides those slots from booking. The teacher picks calendars in Settings and can test the connection.

**Architecture:** A small Workers-compatible Google client (`src/lib/server/calendar/google.ts`) — service-account JWT signed with Web Crypto (RS256), OAuth token exchange, Calendar REST via injected `fetch` — behind a `CalendarClient` interface. When `GOOGLE_SERVICE_ACCOUNT_JSON` is unset the factory returns a disabled client (busy = none, no writes), so dev/memory mode and tests work unchanged. Services receive the client through their deps; every calendar failure is logged and never fails a booking, approval, or cancellation. Settings gain the two existing DB columns (`gcal_write_calendar_id`, `gcal_busy_calendar_ids`) and bookings expose the existing `gcal_event_id`.

**Tech Stack:** SvelteKit 3.1, TypeScript, Web Crypto (`crypto.subtle` RSASSA-PKCS1-v1_5/SHA-256), Google OAuth2 + Calendar API v3 REST, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-booking-app-design.md` ("Google Calendar" decision; Architecture → Google Calendar; data model `settings.gcal_*`, `bookings.gcal_event_id`; Key flows → approve/cancel). Prior plans in `docs/superpowers/plans/`.

## Global Constraints

- Service account approach (spec): teacher shares each calendar with the service-account email ("Make changes to events" for the write calendar; "See all event details" or free/busy is enough for busy-only calendars). No OAuth consent, no refresh tokens, no Google SDK (`googleapis` is Node-only).
- **Never** log, render, or return the private key. The settings page may show the service-account `client_email` only.
- Calendar failures never fail user actions: booking, request submit, approve, decline, cancel all succeed when Google errors or times out (log with `console.error`). Availability **fails open**: if free/busy errors, slots come from the database only (_controller ruling: the teacher still approves every request, so an outage must not take booking offline_).
- Own lesson events are **not** excluded from free/busy: they coincide with approved bookings that already block those times, so double-blocking is harmless (_controller ruling; spec mentioned exclusion — cost if wrong: stale event after a failed delete blocks a slot until removed_).
- Busy intervals go through the existing engine path (`Interval {start, end}` without `blockedUntil`), so the studio buffer applies around them.
- All Google `fetch` calls use `AbortSignal.timeout(5000)`.
- Pending requests never get calendar events; only approval creates one. Decline never touches the calendar. Cancelling an approved lesson with an event deletes it (404/410 = already gone = success) and clears `gcal_event_id`.
- Event content: summary `{lessonTypeName} – {studentName}`; description lines: `Booked by {accountName} ({accountEmail})`, note if any, `Manage in SessionX: {appUrl}/admin/lessons`. Never include a family manage-token link.
- Workers runtime: no Node built-ins; base64url via `btoa`/`atob` + `TextEncoder`.
- SvelteKit 3: `dev` from `$app/env`; env vars declared in `src/env.ts` and read via `$app/env/private`.
- npm installs: `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" …`. Docker unavailable; real Google calls can't run here — the client is verified against a fake `fetch` with a locally generated RSA key.

## Review Focus

1. Google down / free-busy error / timeout → `/book` still shows database-based slots, request submit still works, error logged → Task 3 `availability fails open when calendar errors`, `submit succeeds when calendar errors`.
2. A busy block on a chosen calendar hides overlapping slots (with buffer) and a tampered submit at that time is rejected → Task 3 `busy calendar time hides slots`, `submit rejects a slot that is busy on the calendar`.
3. Event already deleted in Google → cancel still succeeds and clears the id → Task 1 `deleteEvent treats 404 and 410 as success`, Task 3 `cancel clears event id even if Google says gone`.
4. Approve → event created and id stored; cancel → deleted and cleared; decline and pending never touch the calendar → Task 3 tests.
5. Private key never leaves the server: not in logs, page data, or errors → Task 1 `errors never include the private key`, Task 4 settings page data test.

---

### Task 1: Google Calendar client

**Files:** Create `src/lib/server/calendar/types.ts`, `src/lib/server/calendar/google.ts`, `src/lib/server/calendar/google.test.ts`.

**Interfaces — Produces:**

```ts
// types.ts
import type { Interval } from '../availability';
export interface CalendarEventInput {
	summary: string;
	description: string;
	start: Date;
	end: Date;
	timeZone: string;
}
export interface CalendarClient {
	readonly enabled: boolean;
	readonly serviceAccountEmail: string | null;
	createEvent(calendarId: string, event: CalendarEventInput): Promise<string>; // returns event id
	deleteEvent(calendarId: string, eventId: string): Promise<void>; // 404/410 → resolves
	busy(calendarIds: string[], from: Date, to: Date): Promise<Interval[]>; // [] when calendarIds empty
}
// google.ts
export interface GoogleEnv {
	GOOGLE_SERVICE_ACCOUNT_JSON?: string;
}
export function createCalendarClient(
	env: GoogleEnv,
	opts?: { fetchFn?: typeof fetch; now?: () => Date }
): CalendarClient;
// unset/empty → disabled client: enabled=false, serviceAccountEmail=null, busy → [], createEvent/deleteEvent throw Error('Google Calendar is not configured')
// set but not JSON / missing client_email|private_key → throw Error('GOOGLE_SERVICE_ACCOUNT_JSON is invalid') (message must not contain the value)
export async function signServiceAccountJwt(
	clientEmail: string,
	privateKeyPem: string,
	now: Date
): Promise<string>;
// header {alg:'RS256',typ:'JWT'}; claims {iss: clientEmail, scope: 'https://www.googleapis.com/auth/calendar', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat+3600}
// PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----", literal "\n" sequences from env JSON normalised to newlines) → crypto.subtle.importKey('pkcs8', …, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'})
```

Behaviour: access token from `POST https://oauth2.googleapis.com/token` (`application/x-www-form-urlencoded`: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=…`), cached in the client until 60 s before `expires_in`. `createEvent` → `POST https://www.googleapis.com/calendar/v3/calendars/{encodeURIComponent(id)}/events` body `{summary, description, start:{dateTime: ISO, timeZone}, end:{dateTime: ISO, timeZone}}` → `id`. `deleteEvent` → `DELETE …/events/{encodeURIComponent(eventId)}`; 204/200 ok, 404/410 ok. `busy` → `POST https://www.googleapis.com/calendar/v3/freeBusy` body `{timeMin, timeMax, items:[{id}…]}`; merge `calendars[id].busy[]` into `Interval[]`; any `calendars[id].errors` → throw `Error('Free/busy failed for calendar {id}: {reason}')`. Non-2xx → throw `Error('Google API {status} {path}')` (no body echo). Every request `Authorization: Bearer {token}` and `signal: AbortSignal.timeout(5000)`.

- [ ] Step 1: Tests (generate an RSA key pair in the test with `crypto.subtle.generateKey` + export PKCS#8 to PEM; fake `fetch` recording requests): `signs a JWT verifiable with the public key and correct claims`; `normalises escaped newlines in the key`; `exchanges JWT for a token and caches it`; `refreshes the token after expiry`; `createEvent posts the event and returns its id`; `deleteEvent treats 404 and 410 as success`; `deleteEvent throws on 500`; `busy merges intervals across calendars`; `busy returns [] for no calendars without calling Google`; `busy throws when a calendar reports errors`; `disabled client when env unset`; `invalid JSON throws without echoing the value`; `errors never include the private key`; `requests use an abort timeout` (assert `signal` present).
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: Workers-compatible Google Calendar client`.

### Task 2: Store + settings fields for calendar

**Files:** Modify `src/lib/server/store/types.ts`, `memory.ts`, `demo-data.ts`, `supabase.ts`, `supabase-mappers.ts` (+test), `admin-contract.ts`, `supabase.test.ts` (reset hook).

**Interfaces — Produces:**

```ts
// StudioSettings gains:
gcalWriteCalendarId: string | null;
gcalBusyCalendarIds: string[];
// AdminBooking gains:
gcalEventId: string | null;
// AdminStore gains:
setCalendarEventId(bookingId: string, eventId: string | null): Promise<void>;   // not_found
```

`getSettings`/`updateSettings` round-trip both fields in both stores (Supabase columns `gcal_write_calendar_id`, `gcal_busy_calendar_ids`). Demo data: `null` / `[]`. Every `AdminBooking` producer (memory `toAdminBooking`, Supabase `mapAdminBookingRow` + selected columns) includes `gcalEventId`. Callers that build `StudioSettings` literals (tests, `admin-validation.validateSettings`) must be updated so `npm run check` passes — `validateSettings` keeps calendar fields out of its form for now (Task 4 adds them): it returns them as `null`/`[]` and the settings route must merge them from the current settings so saving other settings never wipes calendar choices (add that merge in the settings action in this task).

- [ ] Step 1: Contract tests: `settings round-trip calendar fields`; `setCalendarEventId sets and clears`; `setCalendarEventId unknown id throws not_found`; `admin booking exposes gcalEventId (null by default)`. Mapper test for the new columns. Settings action test or service test: `saving other settings keeps calendar fields`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS (contract skipped for Supabase).
- [ ] Step 5: Commit `feat: calendar fields on settings and bookings`.

### Task 3: Wire calendar into availability, approval, cancellation

**Files:** Create `src/lib/server/calendar/sync.ts` (+test). Modify `src/lib/server/booking-service.ts` (+test), `src/lib/server/admin-service.ts` (+test), `src/lib/server/account-service.ts` (+test).

**Interfaces — Produces:**

```ts
// sync.ts
export async function calendarBusy(
	calendar: CalendarClient | undefined,
	settings: StudioSettings,
	from: Date,
	to: Date
): Promise<Interval[]>;
// [] when no client / disabled / no busy ids; on error console.error and return [] (fail open)
export function lessonEvent(
	b: AdminBooking,
	settings: StudioSettings,
	appUrl: string
): CalendarEventInput;
export async function addLessonToCalendar(
	deps: { store: AppStore; calendar?: CalendarClient; appUrl: string },
	booking: AdminBooking,
	settings: StudioSettings
): Promise<void>;
// skip when no client/disabled/no write calendar/already has gcalEventId; create → setCalendarEventId; errors logged
export async function removeLessonFromCalendar(
	deps: { store: AppStore; calendar?: CalendarClient },
	booking: AdminBooking,
	settings: StudioSettings
): Promise<void>;
// skip when no gcalEventId or no client/disabled; delete (404/410 ok) → setCalendarEventId(null); errors logged (id kept on failure)
```

- `ServiceDeps` and `AdminDeps` gain `calendar?: CalendarClient`.
- `getMonthAvailability(store, lessonTypeId, month, now, student?, calendar?)`: busy intervals = live bookings + `calendarBusy(calendar, settings, rangeStart, rangeEnd)`. The submit re-check (`validateRequestedSlot` path used by guest and account submits) uses the same busy source via `deps.calendar`.
- `decideRequest` approve: after the decision commits and emails are attempted, `addLessonToCalendar` (inside its own try/catch). Decline: no calendar call.
- `cancelLesson`: after `cancelBooking` succeeds, `removeLessonFromCalendar` using the booking returned before the cancel (it carries `gcalEventId`).
- Event description per Global Constraints; event end = booking `endsAt`; `timeZone` = `settings.timezone`.

- [ ] Step 1: Tests (memory store + a fake `CalendarClient` recording calls and optionally throwing; settings with write id `teacher@example.com` and busy ids `['teacher@example.com']`): sync — `calendarBusy returns [] when disabled`, `calendarBusy fails open and logs`, `lessonEvent has summary, times, and admin link but no manage link`; booking — `busy calendar time hides slots` (busy 15:00–16:00 Mon removes 15:00/15:30 60-min slots), `buffer applies around calendar busy time`, `availability fails open when calendar errors`, `submit rejects a slot that is busy on the calendar`, `submit succeeds when calendar errors`; admin — `approve creates calendar event and stores id`, `approve without write calendar does nothing`, `approve succeeds when calendar create fails`, `decline never touches calendar`; account — `cancel deletes event and clears id`, `cancel clears event id even if Google says gone` (fake resolves for 404 semantics), `cancel keeps id and succeeds when delete fails`, `cancel of pending request never touches calendar`.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: PASS.
- [ ] Step 5: Commit `feat: sync lessons with Google Calendar and block busy time`.

### Task 4: Settings UI, connection check, wiring, docs

**Files:** Modify `src/env.ts` (`GOOGLE_SERVICE_ACCOUNT_JSON`), `src/lib/server/context.ts` (`getCalendar(): CalendarClient`, module-level cache), `src/lib/server/admin-validation.ts` (+test: calendar fields), `src/routes/admin/settings/+page.server.ts` + `+page.svelte`, every route that calls the Task 3 services (pass `calendar: getCalendar()` / the extra `getMonthAvailability` arg): `src/routes/book/**`, `src/routes/admin/+page.server.ts` (approve), `src/routes/account/cancel/[id]/+page.server.ts`, `src/routes/manage/[token]/cancel/+page.server.ts`, `.env.local.example`. Create `docs/google-calendar.md`, `src/lib/server/calendar/check.ts` (+test).

**Interfaces:**

- `validateSettings` reads `gcalWriteCalendarId` (blank → null; else trimmed, ≤ 254 chars → `Enter a calendar ID (usually an email address).`) and `gcalBusyCalendarIds` (textarea, one per line or comma-separated; trimmed, blanks dropped, deduped, ≤ 10 → `Use at most 10 calendars.`, each ≤ 254). Remove the Task 2 merge once the fields are in the form.
- `checkCalendarConnection(calendar: CalendarClient, settings: StudioSettings, now: Date): Promise<{ ok: boolean; lines: string[] }>` — disabled → `{ ok:false, lines:['Google Calendar is not configured on the server (GOOGLE_SERVICE_ACCOUNT_JSON).'] }`; else runs `busy` over the next 24 h for the write calendar + busy calendars, one line per calendar `"{id}: OK"` or `"{id}: {error message}"`; never includes key material.
- Settings page: "Google Calendar" section — shows `Share your calendars with: {serviceAccountEmail}` when enabled, else the not-configured note; fields for lesson calendar and busy calendars; "Check connection" button (separate form action → result lines in a banner). Admin-guarded like every admin action. Page data includes `serviceAccountEmail` only.
- `docs/google-calendar.md`: step-by-step — create Google Cloud project, enable Calendar API, create service account, create JSON key, set `GOOGLE_SERVICE_ACCOUNT_JSON` (Cloudflare Pages secret; locally `.env.local`), share calendars with the service-account email and the right permission, find a calendar ID, enter IDs in Settings, click Check connection. Note: personal Gmail works; students don't receive Google invites (they get the `.ics` email).

- [ ] Step 1: Tests: validation (blank → null, list parsing/dedupe, > 10, too long); `checkCalendarConnection` (disabled, per-calendar OK/error lines, no key material); settings load returns `serviceAccountEmail` and no key (route/load test with an injected fake via context or a pure helper).
- [ ] Step 2: FAIL. Step 3: Implement + wire routes. Step 4: `npm run check` 0/0, `npx vitest run`, `npm run lint`, `npm run build`.
- [ ] Step 5: Smoke (memory store, no Google env): `/admin/settings` shows the not-configured note and calendar fields; save calendar IDs → persisted and shown; "Check connection" → not-configured message; booking, approve, and cancel still work end to end (calendar disabled path). Stop the server; port 5173 free.
- [ ] Step 6: Commit `feat: Google Calendar settings, connection check, and setup guide`.

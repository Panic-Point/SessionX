# SessionX: Lesson Booking App, Design & Plan

## Context

SessionX (`Panic-Point/SessionX`, cloned to `C:\Users\awhite\SessionX`, currently only a README) is a booking app for a one-teacher lesson studio. All lessons happen at the teacher's studio. Today every booking happens by text or phone call. The goal is self-serve booking that feels like Calendly, where students only ever see times that are truly open and the teacher keeps control: approving requests, setting hours, prices, rules, and policies. Hosting must be free. The only cost is a domain, about $10 a year, which the user will buy.

Success = a parent or student books from their phone in under a minute, and the teacher stops coordinating times over text.

## Goals (from the user)

1. Calendly-style picker: choose lesson type → month calendar → list of open times for the chosen day → confirm.
2. Only show genuinely available slots.
3. Admin sets weekly hours.
4. Admin manages lesson types: name, length, price.
5. Works in a web browser and as a phone app, delivered as an **installable web app (PWA)**: "Add to Home Screen", no app stores.
6. Free hosting.
7. Admin approves or declines booking requests.
8. Admin sets booking rules (e.g. no same-day bookings: minimum notice, maximum booking window).
9. Admin sets custom prices per student. **Guests see the standard price. A signed-in account sees its own price. Nobody sees anyone else's custom price.**
10. Cancellation policy: admin sets a cutoff (e.g. 24 h). Students can still cancel inside it, but they see a warning that it's outside the policy and they may be charged, and the teacher is emailed.
11. **Scripts to run and test the whole thing locally in Docker.**

## Decisions made in conversation

- **Single teacher, single location** (the teacher's studio). No travel time, no addresses.
- **Accounts and students:** one **account** (usually a parent, identified by email) can have **multiple students** (e.g. siblings). A first booking needs only the account holder's **name and email**, plus who the lesson is for. Anyone can **register** an account up front, before booking; guests who book without one are emailed an invitation to register. Accounts sign in with an email and **password** (no magic links); a password only takes effect after the email is verified by a link, and accounts without one (e.g. created by a guest booking) set one by registering or via "Forgot password?". Booking history and pricing attach by email whether or not they've signed in yet.
- **Payment:** collected manually. Admin can **mark a lesson paid**.
- **Phone/text bookings are not handled** by the app.
- **Confirmed:** a pending request **holds its slot**. Students get **email on approve/decline**. Students **can cancel**.
- **Google Calendar:** approved lessons go on the teacher's Google Calendar automatically, and busy times there block availability.
- **Domain:** the user will buy one. It's required for sending email (Resend) and therefore for sign-in.
- **Stack (handed to me, defaults accepted):** SvelteKit + TypeScript on **Cloudflare Pages**, **Supabase** (Postgres + Auth), **Resend** for email.

## Non-goals (v1)

- Online payments or deposits. Native store apps. SMS or phone intake. Multiple teachers or locations.
- Reminder emails before lessons. _(my call; easy add later via cron)_

## Added after v1

- **Recurring lessons (admin only):** the admin sets up a series for a student, e.g. "Ben, 30-min
  lesson, every Tuesday at 3:00pm": weekly or every 2 weeks, ending on a date, after a number of
  lessons, or never. A `lesson_series` row holds the rule; each occurrence is an ordinary approved
  `bookings` row with `series_id`, so prices, paid tracking, cancellation, the Lessons list and the
  overlap constraint work unchanged. Times are local in `settings.timezone` (3:00pm stays 3:00pm
  across DST). Occurrences are created up to 12 weeks ahead and the daily cron tops them up.
  Creating previews every date and skips (never moves) those that clash with a live booking, a
  closed override or Google busy time; public booking rules don't apply. Families cancel single
  lessons as usual; only the admin can end a series (from a date), which cancels later lessons and
  stops top-ups. One email per series created (with one `.ics`) or ended; one Google Calendar
  event per lesson. Editing a series = end it from a date and start a new one.

## Anti-goals

- A slot is shown that isn't bookable, or two requests get the same slot.
- Anyone sees a custom price that isn't their own, or another family's data.
- Booking takes more steps than Calendly.

## Architecture

- **SvelteKit** with `@sveltejs/adapter-cloudflare`, deployed to Cloudflare Pages from GitHub `main`. The domain is pointed at Cloudflare.
- **All DB access server-side** (`+page.server.ts` / `+server.ts`, Supabase service-role key). The browser never queries Supabase directly. RLS stays on with no anon policies as defense-in-depth. Price resolution happens on the server, and only the resolved price for the current viewer is sent to the page.
- **Auth:** custom sign-in (not Supabase Auth): email and password (PBKDF2-SHA256 via Web Crypto, verified email required, 5 failed attempts per 15 minutes per email), with emailed registration and reset links. Sign-in sets a signed `sx_session` cookie, for accounts and the admin. The admin is an account with `role = 'admin'` (seeded by email). Supabase Auth uses **Resend as custom SMTP**.
- **Email adapter** (`email.ts`) with two backends: Resend API in production, SMTP to the local **Mailpit/Inbucket** in Docker.
- **Google Calendar:** a **service account**. The teacher shares their calendars with its email. On approve → create event. On cancel/decline → delete it. Availability calls `freebusy.query` on the admin-configured calendar IDs. Worker-compatible: JWT signed with Web Crypto, REST via `fetch`. Locally, a stub implementation is used unless credentials are set.
- **Bot check:** Cloudflare Turnstile on the guest form (test keys locally).
- **Scheduled jobs:** a GitHub Actions cron hits a secret-protected `/api/cron` to keep the Supabase free project awake and expire pending requests whose start time has passed.
- **PWA:** manifest, icons, service worker (`@vite-pwa/sveltekit`), mobile-first UI.

## Data model (Postgres)

- `settings` (singleton): `timezone`, `min_notice_hours`, `max_advance_days`, `slot_increment_min` (30), `buffer_min` (0), `cancel_cutoff_hours`, `cancellation_policy_text`, `admin_email`, `gcal_write_calendar_id`, `gcal_busy_calendar_ids[]`.
- `weekly_hours`: `weekday`, `start_time`, `end_time` (multiple ranges per day).
- `date_overrides`: `date`, `is_closed`, optional custom ranges.
- `lesson_types`: `name`, `description`, `duration_min`, `price_cents`, `active`, `sort_order`.
- `accounts`: `name`, `email` (unique, citext), `phone?`, `auth_user_id` (nullable, linked on first sign-in with a matching email), `role`, `admin_notes`.
- `students`: `account_id`, `name`, `notes`. An account holder who is also the student is just a student row with their own name.
- `student_prices`: `student_id`, `lesson_type_id`, `price_cents`. **Per student** _(my call: siblings can have different rates)_.
- `bookings`: `student_id`, `lesson_type_id`, `starts_at`, `ends_at`, `status` ∈ {pending, approved, declined, cancelled, expired}, `late_cancel`, `price_cents` snapshot, `paid_at`, `gcal_event_id`, `note`, `decline_reason`, `manage_token` (guest manage/cancel link).
- **Double-booking guard:** `btree_gist` exclusion constraint on `tstzrange(starts_at, ends_at + buffer)` for `status in ('pending','approved')`.

## Pricing rule (one server function, unit-tested)

`resolvePrice(viewer, studentId?, lessonTypeId)`: guest → list price. Signed-in account → that student's custom price if one exists, else list price. Admin → everything. A signed-in account picks the student first, and prices then show for that student. The snapshot stored on the booking uses the same rule.

## Availability algorithm (unit-tested, TDD)

`getAvailableSlots(lessonTypeId, dateRange)`: open windows from `weekly_hours` and `date_overrides` (in `settings.timezone`) → candidates every `slot_increment_min` that fit the duration → drop those before `now + min_notice` or beyond `max_advance_days` → drop overlaps with pending/approved bookings (± buffer) and Google busy blocks (excluding the app's own events) → days with no slots are greyed out. On submit, re-check that slot server-side. The exclusion constraint is the final guard.

## Key flows

- **Guest booking:** lesson type (standard prices) → date → time → your name/email + student name + note + Turnstile → "Request sent". Emails go to the teacher (new request) and the account (received + manage link).
- **Signed-in booking:** choose a student (or add one) → lesson type (their prices) → date → time → confirm.
- **Admin requests:** pending list, one-tap approve/decline (optional reason) → email (approval email carries an `.ics` file) + Google Calendar event.
- **Cancel:** from the account or the emailed link. Inside the cutoff: policy warning, confirmation, `late_cancel = true`, teacher emailed. Always frees the slot and deletes the Google Calendar event.
- **Admin screens:** Requests, Lessons (upcoming/past, mark paid, filter unpaid or late cancel), Hours & Overrides, Lesson Types, Rules & Cancellation Policy, Accounts & Students (custom prices, notes), Calendar settings.
- **Spam limits** _(my call)_: Turnstile, max 2 pending requests per email.

## Local Docker setup (goal 11)

- **Supabase local stack** via Supabase CLI (`supabase start`, Docker): Postgres, Auth, Studio, Mailpit/Inbucket for catching emails. Migrations in `supabase/migrations/`, seed data in `supabase/seed.sql` (admin account, sample hours, lesson types, a family with two students).
- **App container:** `Dockerfile.dev` + `docker-compose.yml` running the SvelteKit dev server (`vite dev`), joined to the Supabase Docker network. `.env.local.example` holds local keys. Google Calendar is stubbed and Turnstile uses test keys.
- **Cross-platform scripts** (Node scripts behind npm, so they work in PowerShell and bash):
  - `npm run local:up`: `supabase start` + `docker compose up -d app`, then prints URLs (app, Studio, Mailpit).
  - `npm run local:down` / `local:reset` (`supabase db reset` re-runs migrations and the seed).
  - `npm run test`: Vitest unit tests (availability, pricing, cancellation).
  - `npm run test:e2e:docker`: brings the stack up and runs Playwright in the official Playwright container against the app. Emails are read through the Mailpit API.
  - `npm run test:all`: lint + typecheck + unit + E2E, also used by CI.
- `docs/local-dev.md`: prerequisites (Docker Desktop, Node 20+, Supabase CLI) and the commands above.

## Project layout

- `src/lib/server/{availability,pricing,db,email,gcal,auth}.ts`
- `src/routes/book/...`, `src/routes/account/...`, `src/routes/admin/...` (guarded in `hooks.server.ts`), `src/routes/api/cron/+server.ts`
- `supabase/migrations/*.sql`, `supabase/seed.sql`
- `docker-compose.yml`, `Dockerfile.dev`, `scripts/*.mjs`
- `.github/workflows/{ci,cron}.yml`
- `docs/superpowers/specs/2026-10-23-booking-app-design.md`: this design, committed.

## Build order

1. Scaffold SvelteKit + Cloudflare adapter, local Supabase, Docker compose + scripts, CI.
2. Schema + seed. Availability engine and pricing rule test-first.
3. Guest booking flow + emails (Mailpit locally).
4. Admin auth, Requests (approve/decline), Lessons (mark paid).
5. Admin settings: hours, overrides, lesson types, rules, cancellation policy.
6. Accounts: magic link, email linking, students under an account, signed-in pricing, cancel/late-cancel.
7. Per-student custom prices admin UI.
8. Google Calendar sync (service account, freebusy, events).
9. PWA, Turnstile, cron, production deploy (Cloudflare Pages + Supabase cloud + Resend with the new domain).

## Verification

- `npm run local:up` brings everything up on Windows. The app, Supabase Studio, and Mailpit are all reachable.
- `npm run test`: availability (DST, overrides, notice, buffer, overlaps), pricing (guest vs signed-in vs other family), late-cancel logic.
- `npm run test:e2e:docker`: guest books → request email lands in Mailpit → admin approves → student signs in via the magic link from Mailpit → sees own custom price → cancels late → teacher email captured.
- DB test: two concurrent inserts for one slot → one rejected by the exclusion constraint.
- Security: a non-admin can't reach `/admin`. Page payloads never contain another student's price.
- Manual on a real phone after deploy: install to home screen, book, approve, see the event on Google Calendar, confirm a Google busy block hides that slot.

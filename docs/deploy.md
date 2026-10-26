# Deploying SessionX

This guide takes SessionX from your laptop to a live site on Cloudflare Pages with a Supabase
database, Resend email, and an hourly GitHub Actions job. It is written so a non-developer can
follow it with a developer's help. The steps mirror the setup issues on GitHub; issue #7 tracks the
whole launch.

Never paste real keys into this repository, an issue, or a chat. Every value below is a placeholder.

## Checklist

| Step | Issue | What you get                                       |
| ---- | ----- | -------------------------------------------------- |
| 1    | #11   | A domain name                                      |
| 2    | #12   | Resend (email) verified for that domain            |
| 3    | #13   | A Supabase project with the database set up        |
| 4    | #10   | The teacher's admin sign-in and notification email |
| 5    | #14   | The site live on Cloudflare Pages with secrets     |
| 6    | #14   | Turnstile spam check (required for production)     |
| 7    | #15   | Google Calendar sync (optional)                    |
| 8    | #14   | GitHub Actions secrets for the hourly job          |
| 9    | #16   | Post-deploy checks on a browser and a phone        |

## 1. Domain (#11)

Buy a domain (for example `lessons.example.com` or `example.com`) and keep access to its DNS
settings. Cloudflare is the easiest place to manage DNS because Pages and Turnstile live there too.
Throughout this guide the site address is written `https://lessons.example.com`.

## 2. Resend email (#12)

1. Create an account at [resend.com](https://resend.com).
2. Add your domain under Domains and add the DNS records Resend shows (SPF, DKIM). Wait until it
   says Verified.
3. Create an API key with sending access. This is `RESEND_API_KEY`.
4. Decide the From address, for example `SessionX <bookings@lessons.example.com>`. This is
   `EMAIL_FROM`. It must be on the verified domain.

## 3. Supabase (#13)

1. Create a project at [supabase.com](https://supabase.com). Save the database password somewhere
   safe.
2. From the repository folder, link and push the migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   The project ref is the part of the project URL before `.supabase.co`.

3. Do **not** run `supabase/seed.sql`. It is sample data for local development only (fake admin,
   fake family).
4. In the Supabase dashboard, open Project Settings, then API, and note the Project URL
   (`SUPABASE_URL`) and the `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`). The service-role key
   is a server-only secret.

## 4. Make the teacher an admin (#10)

Open the Supabase dashboard, then SQL Editor, and run the following with the teacher's real email
in place of `teacher@example.com`. Change the timezone to the studio's.

```sql
-- Studio settings (exactly one row). admin_email receives new-request notifications.
insert into settings (id, timezone, admin_email)
values (true, 'America/New_York', 'teacher@example.com')
on conflict (id) do update
  set admin_email = excluded.admin_email,
      timezone = excluded.timezone;

-- The teacher's account, with the admin role.
insert into accounts (name, email, role)
values ('Teacher Name', 'teacher@example.com', 'admin')
on conflict (email) do update set role = 'admin';
```

If the teacher already booked as a guest, the second statement simply promotes that existing
account. Opening hours, lesson types, and the cancellation policy are then edited in the app under
`/admin`. The teacher signs in with an emailed link, so the email address must be one they can
read.

## 5. Cloudflare Pages (#14)

1. In the Cloudflare dashboard go to Workers & Pages, Create, Pages, Connect to Git, and pick this
   repository.
2. Build settings:
   - Build command: `npm run build`
   - Build output directory: `.svelte-kit/cloudflare`
   - Node version: the repository contains a `.node-version` file (`22.17.0`), which Cloudflare's
     build image picks up automatically. If you prefer, also set the environment variable
     `NODE_VERSION` = `22.17.0` (or newer). Plain `22` can resolve to an older release than the
     app needs (22.17 or later).
3. Add **every** variable from the table below (Settings, Variables and Secrets) in the Production
   environment, and choose type **Secret** (older dashboard: Encrypt) for all of them, including
   the non-secret ones such as `EMAIL_TRANSPORT`, `PUBLIC_APP_URL`, `SUPABASE_URL`, `EMAIL_FROM`,
   and `TURNSTILE_SITE_KEY`. Because the repository's `wrangler.jsonc` defines the project
   configuration, Cloudflare may ignore or lock plain-text dashboard variables, while Secrets are
   always applied.
4. Deploy. Then add your custom domain under Custom domains.

### Production variables

| Variable                      | Required?               | Secret? | Purpose                                                                                       | Example                                   |
| ----------------------------- | ----------------------- | ------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `SESSION_SECRET`              | Yes (sign-in fails)     | Yes     | Signs admin session cookies. Use a long random string, e.g. `openssl rand -base64 32`.        | `<random 32+ character string>`           |
| `EMAIL_TRANSPORT`             | Yes (booking fails)     | No      | Must be `resend` in production. (`mailpit` is local only; unset only logs emails to console.) | `resend`                                  |
| `RESEND_API_KEY`              | Yes, with `resend`      | Yes     | Resend API key.                                                                               | `re_xxxxxxxx`                             |
| `EMAIL_FROM`                  | Yes, with `resend`      | No      | From address on your verified domain.                                                         | `SessionX <bookings@lessons.example.com>` |
| `PUBLIC_APP_URL`              | Yes                     | No      | Public origin used in email links.                                                            | `https://lessons.example.com`             |
| `SUPABASE_URL`                | Yes                     | No      | Supabase project URL.                                                                         | `https://abcdefgh.supabase.co`            |
| `SUPABASE_SERVICE_ROLE_KEY`   | Yes                     | Yes     | Supabase service-role key (server only).                                                      | `<service_role key>`                      |
| `CRON_SECRET`                 | Yes                     | Yes     | Shared secret for the hourly job. Unset disables `/api/cron`. Must equal the GitHub secret.   | `<random 32+ character string>`           |
| `TURNSTILE_SITE_KEY`          | Required for production | No      | Turnstile site key. The check is skipped only when unset (meant for local development).       | `0x4AAAAAAA...`                           |
| `TURNSTILE_SECRET_KEY`        | Required for production | Yes     | Turnstile secret key (server only).                                                           | `0x4AAAAAAA...`                           |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Optional                | Yes     | Google service-account key JSON, one line. Unset turns calendar sync off. See below.          | `{"type":"service_account",...}`          |
| `MAILPIT_URL`                 | No, local only          | No      | Mailpit address for local email testing. Do not set in production.                            | (unset)                                   |
| `BOOKING_STORE`               | No, leave unset         | No      | `memory` forces the demo store. Never set this in production.                                 | (unset)                                   |

Generate secrets with `openssl rand -base64 32`, or any password manager's generator. Use a
different value for `SESSION_SECRET` and `CRON_SECRET`.

The site still loads if `SESSION_SECRET` or `EMAIL_TRANSPORT` is missing, but sign-in and booking
fail until both are set.

Changing a variable only takes effect on the next deployment: redeploy after editing.

## 6. Turnstile spam check (#14)

Turnstile stops bots from submitting guest bookings. It is required for production: the app skips
the check only when the keys are unset, which is meant for local development.

1. In the Cloudflare dashboard open Turnstile and choose Add widget.
2. Give it a name, add **both** your custom domain (`lessons.example.com`) and the
   `<project>.pages.dev` hostname, and pick the Managed mode. (Or set Turnstile up after attaching
   the custom domain.) If the hostname you visit is not listed, guests see the spam-check message
   with no widget.
3. Copy the **site key** into `TURNSTILE_SITE_KEY` and the **secret key** into
   `TURNSTILE_SECRET_KEY`.
4. Redeploy. The check is active only when both keys are set. If Cloudflare's verification service is
   unreachable the booking is still allowed, so an outage never blocks a family.

## 7. Google Calendar (#15, optional)

Follow [google-calendar.md](google-calendar.md) to create the service account and share the
calendars. Then set `GOOGLE_SERVICE_ACCOUNT_JSON` as a Pages secret (the whole key JSON on one
line) and choose the calendars in the admin settings. Leave it unset to run without calendar sync.

## 8. GitHub Actions secrets (hourly job)

An hourly workflow (`.github/workflows/cron.yml`) calls `POST /api/cron`, which keeps the free
Supabase database awake and marks requests whose start time has passed as expired (freeing the
slot). In the GitHub repository go to Settings, Secrets and variables, Actions, and
add two repository secrets:

| Secret        | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| `APP_URL`     | The live address, no trailing slash: `https://lessons.example.com` |
| `CRON_SECRET` | The exact same value as the `CRON_SECRET` Pages variable           |

Until both are set the workflow skips itself harmlessly.

### Important: GitHub pauses idle scheduled workflows

GitHub **disables scheduled workflows after 60 days with no repository activity** (no commits,
issues, or similar). When that happens the hourly job stops, stale requests stop expiring, and a free
Supabase project that receives no traffic **pauses itself**, taking the site's data offline until it
is restored.

To prevent or fix this, the teacher should check the repository's **Actions** tab now and then (for
example once a month):

- If the Cron workflow shows a notice that it was disabled, click **Enable workflow**.
- To run it right away, open Actions, choose Cron, and click **Run workflow**.
- If Supabase has paused the project, open the Supabase dashboard and click Restore.

Any commit or other repository activity resets the 60-day clock.

## 9. Post-deploy checks (#16)

1. Open the site on your domain. It loads over https with no warnings.
2. Sign in as the teacher: go to `/admin`, enter the admin email, and open the emailed link. It
   opens a page where you click **Sign in** to confirm. The link works once and expires after 15
   minutes.
3. In `/admin`, add at least one lesson type and set the weekly hours (a fresh database has
   none).
4. In another browser, make a booking as a guest. Confirm the confirmation email arrives, and that
   the teacher gets a new-request email.
5. As the teacher, approve the booking and check the family gets the approval email.
6. Run the cron job: GitHub, Actions, Cron, **Run workflow**. The run should finish green.
7. Install to the home screen:
   - iPhone: open the site in Safari, tap Share, then Add to Home Screen.
   - Android: open the site in Chrome, tap the menu, then Install app (or Add to Home screen).
8. If Google Calendar is on, confirm the approved lesson appears on the write calendar.

## See also

- [local-dev.md](local-dev.md) for running everything on your own machine
- [google-calendar.md](google-calendar.md) for calendar sync
- Issue #7, the launch tracking issue

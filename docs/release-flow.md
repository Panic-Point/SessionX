# Release flow: dev and production

Every change goes through one long-lived branch, `dev`, before it reaches `main`:

```
feature branch ──PR──▶ dev ──PR──▶ main
                       │           │
                   dev site   production site
```

| Branch | Site                                 | Database              | Who uses it                      |
| ------ | ------------------------------------ | --------------------- | -------------------------------- |
| `dev`  | `https://dev.sessionx-c49.pages.dev` | Test Supabase project | You, on a browser and your phone |
| `main` | Your custom domain (production)      | Production project    | The teacher and families         |

- New work branches off `dev`, and its pull request targets `dev`.
- To release, test on the dev site, then open a pull request from `dev` into `main`.
- The **Branch flow** check fails any pull request into `main` that is not from `dev`.
- CI runs on every pull request and on every push to `dev` and `main`.
- **Migrate database** runs after CI passes on a push to a branch, against that branch's own
  Supabase project only. If the `dev` project ref is ever set to the production ref, it stops
  with an error instead of touching production.
- **Cron** calls `/api/cron` on production and on the dev site, in one job.
- Cloudflare Pages builds `main` as production and `dev` as a preview deployment with its own
  variables, so the dev site never sees production keys.

The dev site is a different web address from production, so the phone treats it as a separate
app: you can install it on your home screen next to the real one.

## One-time setup

These steps need your accounts, so you do them by hand, in order.

### 1. Create the test Supabase project

1. At [supabase.com](https://supabase.com) create a project named `sessionx-test`. Save its
   database password.
2. Apply the migrations from the repository folder (or let the Migrate database workflow do it
   after step 4):

   ```bash
   npx supabase link --project-ref <test-project-ref>
   npx supabase db push
   ```

3. In its SQL Editor run the admin SQL from [deploy.md, step 4](deploy.md#4-make-the-teacher-an-admin-10)
   with **your own** email, so you are the admin of the test site.
4. Note its Project URL and `service_role` key (Project Settings, API).

You may run `supabase/seed.sql` here for sample data, but never on production.

### 2. Cloudflare Pages: build `dev`

In the Cloudflare dashboard open Workers & Pages, the `sessionx` project, Settings.

1. **Builds, Branch control:** keep `main` as the production branch. Set preview branches to
   **Custom branches** and include only `dev`. Each push to `dev` then updates
   `https://dev.sessionx-c49.pages.dev`. Until this is set, every pull request branch also gets a
   preview build that uses the Preview variables, so first check that Preview holds no production
   database keys.
2. **Variables and Secrets, Preview environment:** add the variables below, all as type
   **Secret**, like production. Do not copy the production values for the database, session or
   cron secrets.

| Variable                             | Preview value                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `SUPABASE_URL`                       | The **test** project's URL                                                                       |
| `SUPABASE_SERVICE_ROLE_KEY`          | The **test** project's `service_role` key                                                        |
| `SESSION_SECRET`                     | A new random string (`openssl rand -base64 32`)                                                  |
| `CRON_SECRET`                        | A new random string, different from production                                                   |
| `EMAIL_TRANSPORT`                    | `resend` (to get real sign-in emails) or leave unset to only log them                            |
| `RESEND_API_KEY`                     | Same key as production is fine                                                                   |
| `EMAIL_FROM`                         | e.g. `SessionX Dev <bookings@lessons.example.com>`, so test mail stands out                      |
| `PUBLIC_APP_URL`                     | `https://dev.sessionx-c49.pages.dev`, or leave unset to use the address the site was opened on   |
| `GOOGLE_SERVICE_ACCOUNT_JSON`        | **Leave unset**, so tests never touch the real calendar                                          |
| `TURNSTILE_SITE_KEY` / `_SECRET_KEY` | Leave unset, or add `dev.sessionx-c49.pages.dev` to the widget's hostnames and use the same keys |

3. Redeploy (or push to `dev`) so the variables take effect.

Emails from the dev site only go to addresses stored in the test database, so they reach real
families only if you book with a real family's email. Use your own addresses when testing.

If you want to test calendar sync, create a separate test calendar in Google, share it with the
service account, set `GOOGLE_SERVICE_ACCOUNT_JSON` in Preview, and pick only that calendar in the
dev site's admin settings.

### 3. Make `dev` the default branch

The `dev` branch already exists. Make it the default branch (Settings, General, Default branch) so
new pull requests target it automatically. The hourly Cron workflow always runs from the default
branch, so this is also where its file is read from.

### 4. GitHub Actions secrets

Settings, Secrets and variables, Actions, **Repository secrets**. The production secrets you
already have keep their names. Add:

| Secret                     | Value                                            |
| -------------------------- | ------------------------------------------------ |
| `DEV_SUPABASE_PROJECT_REF` | The test project ref                             |
| `DEV_SUPABASE_DB_PASSWORD` | The test project's database password             |
| `DEV_APP_URL`              | `https://dev.sessionx-c49.pages.dev`             |
| `DEV_CRON_SECRET`          | The same value as `CRON_SECRET` in Pages Preview |

`SUPABASE_ACCESS_TOKEN` is shared by both.

### 5. Branch protection

Settings, Rules (or Branches), add a rule for each of `main` and `dev`:

- Require a pull request before merging.
- Require status checks to pass: **test** (CI) on both, and **check** (Branch flow) on `main`.
- Block force pushes and deletion.

### 6. Check it works

1. Merge any small pull request into `dev`. In Actions, CI then Migrate database run green, and
   the Migrate log says it linked the test project.
2. Open `https://dev.sessionx-c49.pages.dev`, sign in with **Forgot password?** using your email,
   add a lesson type and hours, and make a test booking.
3. On your phone, open the dev address and add it to the home screen (iPhone: Safari, Share, Add
   to Home Screen; Android: Chrome menu, Install app).
4. Run Cron by hand (Actions, Cron, Run workflow). The Production and Dev steps are green.

## Hotfixes

An urgent production fix still goes through `dev`: merge it into `dev`, then open the `dev` to
`main` pull request straight away. This keeps the two branches from drifting apart.

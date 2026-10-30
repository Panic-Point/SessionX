# Release flow: dev, QA, production

Every change moves through three long-lived branches:

```
feature branch ──PR──▶ dev ──PR──▶ qa ──PR──▶ main
                       │           │          │
                 dev site     QA site   production site
```

| Branch | Site                                 | Database                  | Who uses it                      |
| ------ | ------------------------------------ | ------------------------- | -------------------------------- |
| `dev`  | `https://dev.sessionx-c49.pages.dev` | Test Supabase project     | You, on a browser and your phone |
| `qa`   | `https://qa.sessionx-c49.pages.dev`  | Test project (or its own) | Final check before release       |
| `main` | Your custom domain (production)      | Production project        | The teacher and families         |

- New work branches off `dev` and its pull request targets `dev`.
- To release, open a pull request from `dev` into `qa`, test the QA site, then open one from `qa`
  into `main`.
- The **Branch flow** check fails any pull request into `qa` that is not from `dev`, and any into
  `main` that is not from `qa`.
- CI runs on every pull request and on every push to the three branches.
- **Migrate database** runs after CI passes on a push to a branch, against that branch's own
  Supabase project only. If a `dev` or `qa` project ref is ever set to the production ref, it stops
  with an error instead of touching production.
- **Cron** calls `/api/cron` on each site that has its URL and secret set, in one job.
- Cloudflare Pages builds `main` as production and `dev` and `qa` as preview deployments with
  their own variables, so the dev and QA sites never see production keys.

The dev and QA sites are different web addresses from production, so the phone treats each as a
separate app: you can install the dev site to your home screen next to the real one.

## Why dev and QA share a test database by default

Supabase's free plan allows two active projects. Production takes one, so the second is a test
project shared by dev and QA. Migrations reach it when they merge into `dev`. Because migrations
must already be additive (see [deploy.md](deploy.md#automatic-database-migrations)), the QA code
keeps working with a schema that is a step ahead.

If you want QA fully separate later, create a third Supabase project (this needs a paid Supabase
plan or another free organization), fill in the `QA_` secrets below and give QA its own Pages
project with `qa` as its production branch. No workflow changes are needed.

## One-time setup

These steps need your accounts, so they are done by hand. Do them in order.

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

### 2. Cloudflare Pages: build `dev` and `qa`

In the Cloudflare dashboard open Workers & Pages, the `sessionx` project, Settings.

1. **Builds, Branch control:** keep `main` as the production branch. Set preview branches to
   **Custom branches** and include `dev` and `qa` (exclude everything else). Each push to those
   branches then updates `https://dev.sessionx-c49.pages.dev` and `https://qa.sessionx-c49.pages.dev`.
   Until this is set, every pull request branch also gets a preview build that uses the Preview
   variables, so first check that Preview holds no production database keys.
2. **Variables and Secrets, Preview environment:** add the variables below, all as type
   **Secret**, like production. Do not copy the production values for the database, session or
   cron secrets.

| Variable                             | Preview value                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                       | The **test** project's URL                                                                                                       |
| `SUPABASE_SERVICE_ROLE_KEY`          | The **test** project's `service_role` key                                                                                        |
| `SESSION_SECRET`                     | A new random string (`openssl rand -base64 32`)                                                                                  |
| `CRON_SECRET`                        | A new random string, different from production                                                                                   |
| `EMAIL_TRANSPORT`                    | `resend` (to get real sign-in emails) or leave unset to only log them                                                            |
| `RESEND_API_KEY`                     | Same key as production is fine                                                                                                   |
| `EMAIL_FROM`                         | e.g. `SessionX Dev <bookings@lessons.example.com>`, so test mail stands out                                                      |
| `PUBLIC_APP_URL`                     | **Leave unset.** Email links then use whichever site sent them (dev or QA)                                                       |
| `GOOGLE_SERVICE_ACCOUNT_JSON`        | **Leave unset**, so tests never touch the real calendar                                                                          |
| `TURNSTILE_SITE_KEY` / `_SECRET_KEY` | Leave unset, or add `dev.sessionx-c49.pages.dev` and `qa.sessionx-c49.pages.dev` to the widget's hostnames and use the same keys |

3. Redeploy (or push to `dev`) so the variables take effect.

Emails from the test site only go to addresses stored in the test database, so they reach real
families only if you book with a real family's email. Use your own addresses when testing.

If you want to test calendar sync, create a separate test calendar in Google, share it with the
service account, set `GOOGLE_SERVICE_ACCOUNT_JSON` in Preview, and pick only that calendar in the
test site's admin settings.

### 3. Create the branches

Create `dev` and `qa` from `main` (GitHub, Branches, New branch, or
`git push origin main:dev main:qa`). Then make `dev` the default branch (Settings, General,
Default branch) so new pull requests target it automatically. The hourly Cron workflow always runs
from the default branch, so this is also where its file is read from.

### 4. GitHub Actions secrets

Settings, Secrets and variables, Actions, **Repository secrets**. The production secrets you
already have keep their names. Add:

| Secret                     | Value                                            |
| -------------------------- | ------------------------------------------------ |
| `DEV_SUPABASE_PROJECT_REF` | The test project ref                             |
| `DEV_SUPABASE_DB_PASSWORD` | The test project's database password             |
| `DEV_APP_URL`              | `https://dev.sessionx-c49.pages.dev`             |
| `DEV_CRON_SECRET`          | The same value as `CRON_SECRET` in Pages Preview |

Leave the `QA_SUPABASE_PROJECT_REF`, `QA_SUPABASE_DB_PASSWORD`, `QA_APP_URL` and `QA_CRON_SECRET`
secrets unset while QA shares the test database: dev already migrates it and keeps it awake. Set
them only if QA gets its own project. `SUPABASE_ACCESS_TOKEN` is shared by all three.

### 5. Branch protection

Settings, Rules (or Branches), add a rule for each of `main`, `qa` and `dev`:

- Require a pull request before merging.
- Require status checks to pass: **test** (CI) on all three, and **check** (Branch flow) on `main`
  and `qa`.
- Block force pushes and deletion.

### 6. Check it works

1. Merge any small pull request into `dev`. In Actions, CI then Migrate database run green, and
   the Migrate log says it linked the test project.
2. Open `https://dev.sessionx-c49.pages.dev`, sign in with **Forgot password?** using your email, add a
   lesson type and hours, and make a test booking.
3. On your phone, open the dev address and add it to the home screen (iPhone: Safari, Share, Add
   to Home Screen; Android: Chrome menu, Install app).
4. Run Cron by hand (Actions, Cron, Run workflow). Production and Dev steps are green; QA says it
   was skipped.

## Hotfixes

An urgent production fix still goes through `dev` and `qa`: merge it into `dev`, then open the
`dev` to `qa` and `qa` to `main` pull requests straight away. This keeps the three branches from
drifting apart.

# SessionX

Booking app for a one-teacher lesson studio. Families request lessons online, the teacher approves
them, and everyone gets email confirmations.

## Features

- Public booking page: choose a lesson type, see open times, and request a slot as a guest
- Teacher admin area: approve or decline requests, set weekly hours, date overrides, lesson types,
  and the cancellation policy
- Family accounts with several students and per-student pricing
- Email notifications (Resend in production)
- Optional Google Calendar sync
- Turnstile spam check on guest bookings
- Installable on phones (home-screen app with an offline fallback)

## Tech stack

SvelteKit 3 and Svelte 5 with TypeScript, Supabase (Postgres) for data, Resend for email,
Cloudflare Pages for hosting, GitHub Actions for the hourly scheduled job, and Vitest for tests.

## Quick start

```bash
npm install
npm run dev
```

With no configuration the app runs on built-in sample data (nothing is saved between restarts).
Sign-in links are printed in the terminal where `npm run dev` is running, so no email setup is
needed. Open http://localhost:5173.

Sample sign-in emails for development: `admin@sessionx.local` (the teacher/admin) and
`parent@example.com` (a family with students Ava and Ben).

## Tests

```bash
npm test          # unit tests
npm run check     # type check
npm run lint      # formatting check
npm run test:all  # all of the above
```

## Documentation

- [Local development](docs/local-dev.md): Docker and Supabase on your machine
- [Deploying to production](docs/deploy.md): domain, email, database, hosting, secrets
- [Google Calendar setup](docs/google-calendar.md)
- Launch tracking: issue #7

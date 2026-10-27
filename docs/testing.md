# Testing guide

A walk-through for trying every SessionX feature by hand on your own computer. Each section says
what to do and what you should see. Work through them in order the first time: later sections
reuse the bookings made in earlier ones.

## Before you start

Start the app with one of these:

- **Full local stack (recommended):** `npm run local:up` (see [local-dev.md](local-dev.md)). Data
  is saved in the local database, and every email lands in Mailpit at http://localhost:54324.
- **Quick mode:** `npm run dev` with no `.env.local`. The app uses built-in sample data that resets
  every time the server restarts, and emails are printed in the terminal where `npm run dev` is
  running instead of being sent.

Open the app at http://localhost:5173.

To start over with fresh sample data, run `npm run local:reset` (full stack) or restart
`npm run dev` (quick mode).

### Sample data

Both modes start with the same data:

| What          | Details                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| Admin         | `admin@sessionx.local` (the teacher)                                                    |
| Family        | `parent@example.com` (Pat Parent), with students **Ava** and **Ben**                    |
| Lesson types  | 30-minute ($35), 45-minute ($50), 60-minute ($65)                                       |
| Custom price  | Ben pays **$30** for the 30-minute lesson                                               |
| Weekly hours  | Monday to Friday 3pm to 8pm, Saturday 9am to 1pm (Eastern Time). Closed Sunday.         |
| Booking rules | 24 hours minimum notice, up to 60 days ahead, start times every 30 minutes, no same-day |
| Cancellation  | Cancelling less than 24 hours before an approved lesson counts as a late cancellation   |
| Recurring     | Ben has a weekly 30-minute lesson every Tuesday at 4pm, booked 12 weeks ahead           |

### Where the emails go

Every email in this guide (registration and reset links, request confirmations, approvals,
cancellations) shows up
in **Mailpit** (http://localhost:54324) on the full stack, or in the **terminal** in quick mode.
Mailpit catches everything regardless of the address, so `parent@example.com` and made-up guest
addresses all work.

## 1. Signing in and registering

Everyone signs in with an email and password. The seeded accounts have dev passwords:
`admin@sessionx.local` / `sessionx-admin-dev` and `parent@example.com` / `sessionx-parent-dev`.

1. Click **Sign in** (top right), or go to http://localhost:5173/login.
2. Enter `admin@sessionx.local` and `sessionx-admin-dev`, and click **Sign in**.
3. As the admin you land on the admin area at `/admin`. A family lands on **My lessons** at
   `/account`.

To sign in as the family instead, sign out first (**Sign out** in the admin menu or top right),
then repeat with `parent@example.com`. Tip: use a private browser window for the second person so
you can be signed in as the admin and the family at the same time.

Things to check:

- **Register before booking:** signed out, click **Register** on the sign-in page. Enter a name, a
  new email, and a password of at least 10 characters twice. The page says "Check your email to
  finish creating your account". Open **Finish creating your SessionX account** in Mailpit, follow
  the link and click **Confirm and sign in**. You land on `/account` with no lessons yet, ready to
  book.
- **Existing family's email:** register with `parent@example.com`. You see the same message, and
  the old password keeps working until the emailed link is used. After that, the new password
  works, the account is still named Pat Parent, and Ava and Ben are still there.
- **Wrong password:** a wrong password, an unknown email and an account with no password all show
  "Email or password is incorrect." After 5 failures in 15 minutes the form refuses even the right
  password and suggests resetting it.
- **Forgot password:** click **Forgot password?**, enter the email, and open **Reset your SessionX
  password** in Mailpit (valid 30 minutes, once). Choose a new password; you are signed in and the
  old password stops working. A reset also lifts a lockout. An unknown email shows the same "Check
  your email" message but sends nothing, so nobody can find out who has an account.
- **Change a password:** on `/account`, the **Password** section changes it (the current password
  is required).
- **Weak passwords:** fewer than 10 characters, or a common one such as `qwertyuiop`, is rejected
  next to the field.
- **Admin pages are protected:** signed out, go to http://localhost:5173/admin. You are sent to the
  sign-in page. Signed in as the family, the same address shows "Only the studio admin can view
  this page."

A guest who books a lesson (section 4) also gets a **Create your SessionX account** email. Its link
opens the registration form with the guest's email filled in; registering with that email keeps
the guest's lessons.

## 2. Lesson types and prices (admin)

Sign in as the admin and open **Lesson types**.

1. Under **Add a lesson type**, fill in a name (for example "Trial lesson"), an optional
   description, a length in minutes, a price in dollars, and a sort order. Leave **Offered for
   booking** ticked and click **Add lesson type**.
2. Open http://localhost:5173/book in a signed-out window. The new type is listed, in sort order
   (lower numbers first), with its price.
3. Back in the admin, click **Edit** on a lesson type, change its price, and click **Save
   changes**. Refresh the booking page to see the new price.
4. Edit a type and untick **Offered for booking**. It shows an **Inactive** badge in the admin and
   disappears from the booking page. Tick it again to bring it back.

Things to check: a length outside 5 to 480 minutes, an empty name, or a price like "abc" is
rejected with a message next to the field.

## 3. Hours and availability (admin)

Open **Hours**. All times are in the studio time zone (set on the Settings page).

### Weekly hours

1. Each weekday lists its opening times. Change a time, add a second range with **+ Add hours**,
   or click **Remove** on a range. A day with no ranges is closed.
2. Click **Save weekly hours**. You see "Weekly hours saved."
3. On the booking page, pick a lesson type. Only days with open times can be picked, and the times
   listed for a day fall inside the hours you set.

Overlapping ranges, or an end time before the start time, are rejected.

### Date overrides

Use these for holidays or one-off changes.

1. Under **Add an override**, pick a date in the next few weeks.
2. Either tick **Closed all day**, or enter special opening times for just that date. Add an
   optional note, then click **Save override**.
3. The override appears in the list. On the booking page that date is now closed, or shows only the
   special times.
4. Click **Delete** on the override and the date goes back to its weekly hours.

### Booking rules

Open **Settings** and try these one at a time, checking the booking page after each save:

| Setting                          | What to try                   | What you should see                                     |
| -------------------------------- | ----------------------------- | ------------------------------------------------------- |
| Minimum notice (hours)           | Change 24 to 72               | No times in the next 3 days                             |
| Booking window (days)            | Change 60 to 7                | Only the next week can be booked                        |
| Start times every                | Change 30 to 60 minutes       | Times are on the hour only                              |
| Buffer between lessons (minutes) | Set 15, then book a lesson    | The 15 minutes after that lesson can't be booked either |
| Allow same-day bookings          | Tick it and set notice to 0   | Times later today appear                                |
| Studio time zone                 | Change to America/Los_Angeles | Weekly hours now apply in Pacific Time                  |

Put the settings back afterwards (24, 60, 30, 0, unticked, America/New_York), since later sections
assume the defaults.

## 4. Booking as a guest

Use a signed-out (or private) window.

1. Go to http://localhost:5173 and click **Book a lesson**.
2. Choose a lesson type, then a day on the calendar, then a time.
3. On the details page fill in **Your name**, **Email** (any address, for example
   `guest@example.com`), and **Student's name**. Add a note if you like, then click **Request
   lesson**.
4. You see **Request sent!** and a **View your request** button.

Emails to check:

- The guest gets **Lesson request received** with a link to manage the request.
- The admin (the **Notification email** on the Settings page) gets **New lesson request** with the
  details and a link to the admin area.

Things to check:

- **Manage link:** open **View your request** (or the link in the email). It shows the lesson as
  **Pending approval** and has a **Cancel this lesson** link. Nobody needs to sign in to use it.
- **Times are held:** a requested time disappears from the booking page for everyone, even before
  it is approved.
- **Guest prices are list prices:** book as a guest with email `parent@example.com` and student
  name `Ben`. The 30-minute lesson shows $35, not Ben's custom $30. Custom prices only show when
  the family is signed in.
- **Pending limit:** each family can have at most 2 requests waiting for approval. A third request
  from the same email shows "You already have 2 lesson requests waiting for approval".
- **New family:** after booking with a new email, that email can sign in (section 1) and the family
  appears under **Families** in the admin.

## 5. Booking as a signed-in family

Sign in as `parent@example.com`.

1. Click **Book a lesson**. First you choose who the lesson is for: **Ava** or **Ben**. You can also
   add a new student right there.
2. Choose **Ben**. The 30-minute lesson shows **$30** (his custom price). Choose **Ava** instead and
   it shows $35.
3. Pick a time and click **Request lesson**. There is no name or email form, since the account is
   already known; just an optional note.
4. **My lessons** now lists the request under **Upcoming lessons** as **Pending approval**.

On **My lessons** you can also add a student or rename one under **Students**. Two students in one
family can't have the same name.

## 6. Approving and declining requests (admin)

Sign in as the admin. **Requests** lists every pending request that hasn't started yet.

1. Click **Approve** on one request. It leaves the list.
   - The family gets **Lesson confirmed** with a `lesson.ics` calendar invite attached (open it to
     add the lesson to any calendar app).
   - The lesson now shows as **Confirmed** on the family's My lessons page and appears under
     **Lessons** > **Upcoming** in the admin.
2. On another request click **Decline…**, optionally type a reason, and click **Decline request**.
   - The family gets **Lesson request declined**, including your reason.
   - The time becomes bookable again.

## 7. Tracking lessons and payments (admin)

Open **Lessons**.

- **Upcoming** lists approved lessons from now on; **Past** lists approved lessons that have
  already started.
- Click **Mark paid** on a lesson. It shows **Paid ✓**; click **Mark unpaid** to undo.
- Turn on **Unpaid only** to hide lessons that are already paid.
- **Late cancels** lists lessons the family cancelled inside the cancellation cutoff (section 9).

## 8. Families and per-student prices (admin)

Open **Families** and click **Pat Parent**.

- **Account notes** and each student's **Notes** are private notes for the teacher. Type something
  and click **Save notes**; families never see them.
- Each student has a **Prices** table listing every lesson type with its list price and a **Custom
  price ($)** field. Ben's 30-minute lesson already has 30.00.

To try it:

1. Give **Ava** a custom price of 40 for the 60-minute lesson and click **Save prices**.
2. In the family's window, start booking for Ava. The 60-minute lesson shows $40.
3. Clear the field and save again; Ava is back on the list price of $65.

Custom prices only apply to bookings the family makes while signed in. A booking keeps the price
it was made at, even if you change prices later.

## 9. Cancelling and the late-cancel warning

Families can cancel a pending or approved lesson that hasn't started, from **My lessons** (the
**Cancel** button) or from the manage link in their emails.

### Normal cancel

1. As the family, click **Cancel** on an upcoming lesson. The page shows the lesson details and
   **Cancel lesson** / **Keep lesson** buttons.
2. Click **Cancel lesson**. You see "Lesson cancelled", and the lesson moves to **Past lessons** as
   **Cancelled**.
3. The family gets **Lesson cancelled – …** and the admin gets **Lesson cancelled: …**. The time
   is bookable again.

### Late cancel

The minimum notice and the cutoff are both 24 hours by default, so a fresh booking is never late.
To see the warning:

1. Book a lesson about 2 days from now and approve it as the admin.
2. In admin **Settings**, set **Cancellation cutoff (hours)** to 72 and save.
3. As the family, click **Cancel** on that lesson. A warning says it is less than 72 hours before
   the lesson and may still be charged, followed by your cancellation policy text.
4. Cancel it anyway. The admin's email is titled **Late cancellation: …**, the lesson appears
   under **Lessons** > **Late cancels**, and the family's past lessons show a **Late
   cancellation** badge.
5. Set the cutoff back to 24.

Only approved lessons can be late. Cancelling a request that is still pending never shows the
warning.

## 10. Google Calendar sync (optional)

This needs a Google service account. Follow [google-calendar.md](google-calendar.md) to create one,
then add the `GOOGLE_SERVICE_ACCOUNT_JSON` line to `.env.local` and restart the app (run
`npm run local:up` again, or restart `npm run dev`).

Without it, the **Google Calendar** section of the Settings page says it is not set up yet. That is
the normal state for local testing, and booking works the same.

With it set up:

1. Admin **Settings** shows "Share your calendars with" and the service account's email. Share a
   test calendar with that address in Google Calendar.
2. Enter the calendar's ID as the **Lesson calendar**, and optionally as a **Busy calendar**, then
   click **Save settings**.
3. Click **Check connection**. Each calendar should get an OK line. (The check briefly adds and
   removes a "SessionX connection check" event on the lesson calendar.)
4. **Lesson calendar:** approve a request. The lesson appears in the Google calendar. Cancel it as
   the family and it disappears.
5. **Busy calendars:** add an event in a busy calendar during your opening hours, for example
   tomorrow 4pm to 5pm. On the booking page those times are no longer offered.

## 11. Spam check on guest bookings (optional)

The Cloudflare Turnstile check only runs when both Turnstile keys are set, so it is off locally by
default. Signed-in families never see it.

To try it, add Cloudflare's public test keys to `.env.local` and restart the app:

```sh
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

1. As a guest, go to the details page of a booking. A Turnstile box appears above the **Request
   lesson** button and passes by itself (that's what this test key does).
2. Submit. The request goes through as usual.
3. Change the secret to `2x0000000000000000000000000000000AA` (Cloudflare's "always fails" key),
   restart, and submit again. You see "Please complete the spam check and try again."

Remove both lines afterwards.

## 12. Home-screen app and offline page

SessionX can be installed like an app, and shows a friendly page when there is no connection.

On a computer, in Chrome or Edge at http://localhost:5173:

1. An install icon appears at the right of the address bar. Click it to install SessionX; it opens
   in its own window with the SessionX icon.
2. To try offline mode, open developer tools (F12), go to **Application** > **Service workers**, and
   tick **Offline**. Reload or navigate: you see **You're offline** with a **Try again** button.
   Untick **Offline** and click **Try again** to get back.

Phones only offer installing on a real `https://` address, so test on a phone with the deployed
site (iPhone: Safari, Share, **Add to Home Screen**; Android: Chrome menu, **Install app**).

## 13. Expiring old requests (scheduled job)

In production an hourly job turns pending requests whose time has passed into **Expired**. Locally
it is off until you set a secret.

1. Add `CRON_SECRET=local-test-secret` to `.env.local` and restart the app.
2. Run:

   ```sh
   curl -X POST -H "Authorization: Bearer local-test-secret" http://localhost:5173/api/cron
   ```

3. The response is `{"ok":true,"expired":0,"seriesToppedUp":1,"lessonsAdded":0}`. `expired` is how
   many requests were expired; the other two count recurring series extended (see section 14). A
   wrong secret gives a 401, and no secret configured gives a 503.

A request only expires once its lesson time has passed, so the count is usually 0 locally.

## 14. Recurring lessons (admin)

1. Sign in as the admin, open **Families**, then **Pat Parent**. Under **Ben**, **Recurring
   lessons** lists the sample **Weekly · Tue 4:00pm** series.
2. Open **Set up recurring lessons** under Ben. Choose the 30-minute lesson, **Tuesday**, `15:00`,
   **Every week**, a start date this week, **After a number of lessons**, `10`. Click **Preview
   dates**: you see 10 Tuesdays at 3:00 PM, each marked **OK** (dates after a clock change still
   say 3:00 PM).
3. To see clashes: book a guest lesson on one of those Tuesdays at 3pm (section 4), add a closed
   date override on another (section 3), then preview again. Those dates are crossed out with the
   reason, and the button says how many will be booked.
4. Click **Book N lessons**. The page lists what was booked and skipped. The skipped guest booking
   is unchanged. Pat gets one email listing every date with a `lessons.ics` attachment, and the
   lessons appear in **Lessons** (tagged **Weekly · Tue 3:00pm**), on Pat's **My lessons** (tagged
   **Weekly**) and, with Google Calendar set up, one event per lesson.
5. Go to **Book a lesson** as a guest: those Tuesday 3pm times are not offered.
6. Open the series (from the family page or the tag in **Lessons**). **Cancel this lesson** cancels
   one (Pat gets the usual cancellation email); the rest stay. **Cancel this and later** or **Cancel
   remaining lessons** ends the series: future lessons are cancelled, past ones stay, and Pat gets
   one email listing the cancelled dates.
7. As Pat, cancel one series lesson from **My lessons**: it works like any lesson, including the
   late-cancel warning. Families can't cancel a whole series.

A series with no end, or one that runs past 12 weeks, only has lessons 12 weeks ahead. The daily
scheduled job (section 13) adds the next ones; with `npm run dev` the sample series is filled in
when the server starts.

## Automated tests

Most of the rules above are also covered by automated tests. See the commands in
[local-dev.md](local-dev.md#commands): `npm test` for unit tests and `npm run test:all` for
everything CI runs.

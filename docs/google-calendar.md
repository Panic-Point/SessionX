# Connect Google Calendar

SessionX can work with your Google Calendar in two ways:

- **Lesson calendar:** each approved lesson is added to this calendar, and it is removed again
  when the lesson is cancelled.
- **Busy calendars:** times that are busy on these calendars (doctor's visits, your own plans)
  can't be booked.

Lessons approved before Google Calendar was set up are not added automatically; only lessons
approved afterwards appear.

A free personal Gmail account works. You don't need Google Workspace.

Students and families don't get Google Calendar invites. They keep getting the confirmation email
with a calendar file (`.ics`) attached, which works with any calendar app.

Setup takes about 15 minutes. You'll create a "service account", which is a robot Google account
that SessionX signs in as. Then you share your calendars with it, the same way you'd share a
calendar with a person.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com> and sign in with the Google account that owns your
   calendars. If asked, accept the terms of service.
2. Click the project picker at the top of the page (it may say **Select a project**), then click
   **New project**.
3. Name it something like `SessionX` and click **Create**.
4. When it's ready, make sure the new project is selected in the project picker.

This doesn't cost anything. The Calendar API is free at a studio's scale, and you don't need to add
billing details.

## 2. Turn on the Google Calendar API

1. Open the menu (☰) and go to **APIs & Services** > **Library**.
2. Search for **Google Calendar API** and click it.
3. Click **Enable**.

## 3. Create the service account

1. Open the menu (☰) and go to **IAM & Admin** > **Service Accounts**.
2. Click **Create service account**.
3. Give it a name, for example `sessionx-calendar`, and click **Create and continue**.
4. Skip the optional role and access steps: click **Continue**, then **Done**.
5. The list now shows the new account with an email address ending in
   `.iam.gserviceaccount.com`. You'll need this address in step 6.

## 4. Create a key

1. In the **Service Accounts** list, click the service account's email address.
2. Open the **Keys** tab.
3. Click **Add key** > **Create new key**.
4. Choose **JSON** and click **Create**. A `.json` file downloads to your computer.

This file is the password for the service account, and it's the only copy. Don't email it or put
it anywhere public. If it leaks, delete the key on this same tab and create a new one.

If **Create new key** is greyed out or shows an error about an organization policy, your Google
account belongs to an organization that blocks keys. Ask its administrator to allow service account
keys for this project, or use a personal Gmail account instead.

## 5. Give the key to SessionX

The setting is called `GOOGLE_SERVICE_ACCOUNT_JSON`, and its value is the **entire contents** of
the downloaded `.json` file.

### On the live site (Cloudflare Pages)

1. Open the `.json` file in a text editor such as Notepad or TextEdit, select everything, and copy
   it.
2. In the Cloudflare dashboard, go to **Workers & Pages** and select the SessionX project.
3. Go to **Settings** > **Variables and Secrets** for the **Production** environment (and
   **Preview** too, if you use it) and click **Add**.
4. Enter the name `GOOGLE_SERVICE_ACCOUNT_JSON`, choose the type **Secret**, and paste the file
   contents as the value. (Older dashboards have an **Encrypt** button instead; click it so it's
   stored as a secret.)
5. Click **Save**.
6. Deploy the site again. A new secret is only used by deployments made after it was saved.

Once saved, Cloudflare won't show the value again. That's expected.

### On your own computer (developers only)

Add one line to `.env.local`. The value must be on a single line, so convert the file first:

```sh
node -e "console.log(JSON.stringify(require('./path/to/key.json')))"
```

Then paste the output inside single quotes:

```sh
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

Restart the dev server afterwards. `.env.local` is never committed.

## 6. Share your calendars with the service account

Do this on a computer, at <https://calendar.google.com>. The phone app can't change sharing.

1. Click the gear icon, then **Settings**.
2. On the left, under **Settings for my calendars**, click the calendar you want to share.
3. Under **Share with specific people or groups**, click **Add people and groups**.
4. Paste the service account's email address (the one ending in `.iam.gserviceaccount.com`). The
   Settings page in SessionX shows it too, next to **Share your calendars with**.
5. Choose the permission:
   - For the **lesson calendar**: **Make changes to events**.
   - For **busy calendars**: **See only free/busy (hide details)** is enough.
6. Click **Send**. Google might say the address is outside your organization. That's fine.

Tip: many teachers create a separate calendar just for lessons. On the left of Google Calendar,
click **+** next to **Other calendars** > **Create new calendar**. You can use the same calendar as
the lesson calendar and as a busy calendar.

## 7. Find each calendar ID

1. Still in Google Calendar settings, click the calendar on the left.
2. Scroll down to **Integrate calendar**.
3. Copy the **Calendar ID**.

Your main calendar's ID is your Gmail address. Other calendars have a long ID ending in
`@group.calendar.google.com`.

## 8. Enter the IDs in SessionX

1. In SessionX, go to **Admin** > **Settings**.
2. Under **Google Calendar**, check that the page says **Share your calendars with:** followed by the
   service account email. If it says Google Calendar isn't set up, go back to step 5.
3. Paste the lesson calendar ID into **Lesson calendar**.
4. Paste busy calendar IDs into **Busy calendars**, one per line (up to 10).
5. Click **Save settings**.

## 9. Check the connection

Click **Check connection**. SessionX tries to read each saved calendar and shows one line per
calendar:

- `your-calendar-id: OK` means it's working.
- Any other message means the calendar couldn't be read. Usually the calendar isn't shared with the
  service account yet, or the ID was copied wrong. Fix it, save, and check again. A new share can
  take a few minutes to start working.

## 10. Add lessons booked before the connection

New lessons go on the lesson calendar by themselves once the connection works. To add the upcoming
approved lessons that were booked before you connected, click **Add lessons** under **Add existing
lessons** on the same page. It adds up to 20 lessons per click and says how many are left, so click
again until it says every upcoming lesson is already on the calendar. Past lessons, pending requests
and cancelled lessons aren't added. Lessons already on the calendar are skipped, so clicking again
never makes duplicates. If a lesson couldn't be added when it was approved (for example Google was
down), this adds it too.

If Google Calendar has a problem later, booking keeps working. SessionX just skips the calendar
until it's fixed.

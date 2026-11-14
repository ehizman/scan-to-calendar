# Scan to Calendar

A small web app that scans an event QR code and adds the event to **Google Calendar** or **Apple Calendar**.
It's static (HTML, CSS and JavaScript), with no server, no accounts and no API keys. Everything runs on the phone, and nothing it scans is uploaded.
It can be installed to the home screen and works offline.

## What it does

1. **Scan.** It uses the phone camera live, a photo or screenshot, or pasted text.
2. **Read.** It understands:
   - iCalendar event data (`BEGIN:VEVENT … END:VEVENT`), the standard "event" QR format
   - Google Calendar "add event" links (`calendar.google.com/…action=TEMPLATE`)
   - Outlook.com / Office 365 "compose event" links

   Other links and plain text are shown so you can fill in the details yourself.
3. **Add.**
   - **Google Calendar** opens with the event filled in. Tap **Save**.
   - **Apple Calendar**: on iPhone and iPad the Calendar "Add" sheet opens. On a Mac an `.ics` file downloads; open it to add the event. On Android and Windows the `.ics` file works with any calendar app, Outlook included.

## Admin: create and project an event QR code

Open **`admin.html`** on the deployed site, for example `https://<your-site>/admin.html`.

1. Enter the title, date, start and end time, location, a short description, and the time zone.
2. Tap **Create QR code**. You'll see:
   - the QR code
   - the **reminder schedule** members will get, including any reminders that were skipped and why
   - **Project on screen**: a full-screen, black-on-white view for the projector, with the screen kept awake. Close it with Esc.
   - **Download PNG** or **Download JPEG**: a high-resolution image, with the title, date and place printed underneath unless you untick the box
   - **Copy link** and **Preview member view**
3. Events are saved on that computer under **Your events**, so you can project them again later.

The QR code holds a link to this app with the event packed into the `#…` part of the address. That part never reaches a server. Members scan it with their **normal phone camera**; they don't need to install anything. The link opens the event with **Google Calendar** and **Apple Calendar** buttons.

The admin page has no login. Anyone can make a QR code with it, but that's all it does: nothing is stored on a server and no one else's data is exposed. Add hosting-level protection (for example Netlify password protection or Cloudflare Access on `/admin.html`) if you want to restrict it.

## Reminders

Reminders are worked out from the event start and the moment the admin taps **Create QR code**. The creation time travels in the link, so every phone gets the same schedule. All times are in the event's time zone.

| Created ahead of the start | Reminders |
|---|---|
| 7 days or more | 3 days before at 11:00 · 2 days before at 11:00 · event day at 12:00 · 1 hour before |
| 3 to under 7 days | 2 days before at 11:00 · 1 day before at 11:00 · 1 hour before |
| 1 to under 3 days | 1 day before at 11:00 · 1 hour before |
| under 1 day | 1 hour before · 15 minutes before |

Then, for each reminder:
1. **Morning events:** if the event starts before 1:00 PM, the event-day 12:00 reminder is skipped.
2. **Quiet hours:** a "before" reminder (1 hour or 15 minutes) that falls between 11:00 PM and 7:00 AM moves to 8:00 AM on the event day. If the event starts before 8:00 AM, so that 8:00 would be too late, it moves to **10:00 PM the night before** instead. That fallback is an addition to the original spec. Example: for a 6:30 AM event, the 5:30 AM reminder becomes 10:00 PM the evening before.
3. **After the start:** a reminder that would land at or after the start is skipped. This is a safety net that isn't in the original spec, and with rule 2's fallback it shouldn't trigger.
4. **Already passed:** a reminder at or before the creation time is skipped.
5. **Duplicates:** two reminders at the same time are kept once (for example a 1:00 PM event, where 12:00 and "1 hour before" coincide).

The rules live in `computeReminders` in `calendar.js`, and `test/reminders.test.js` covers each one.

**Where reminders reach members:** they're written into the calendar file as alarms, so they apply when a member taps **Apple Calendar** (or downloads the `.ics` on Android or Windows). Google Calendar's add-event link has no way to carry reminders, so Google users get their own default Google Calendar reminders.

## Files

| File | What it is |
|---|---|
| `index.html` | Member page: scanner and event view |
| `admin.html` | Admin page: create, project and export event QR codes |
| `styles.css` | Styles for both pages |
| `app.js` | Member page: camera scanning, form, calendar buttons, install prompt |
| `admin.js` | Admin page: form, QR drawing, reminder schedule, PNG/JPEG export, projection, saved events |
| `calendar.js` | Parsing QR contents, invite links, the reminder engine, and building the Google link and `.ics` file (pure functions, unit-tested) |
| `vendor/jsQR.js` | QR decoder ([jsQR 1.4.0](https://github.com/cozmo/jsQR), Apache-2.0, license in `vendor/jsQR-LICENSE`). Used when the browser has no built-in `BarcodeDetector` (Safari, Firefox) |
| `vendor/qrcode.js` | QR encoder ([qrcode-generator 1.4.4](https://github.com/kazuhikoarase/qrcode-generator), MIT, license in the file header) |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest`, `icons/` | Home-screen install metadata and icons |
| `test/` | Unit tests for `calendar.js` |

## Deploy

Live camera scanning needs **https**, which every option below provides.

**Netlify Drop (quickest, about one minute).** Go to https://app.netlify.com/drop and drag this whole folder onto the page. You get an `https://….netlify.app` URL.

**GitHub Pages.**
```bash
cd scan-to-calendar
git init && git add . && git commit -m "Scan to Calendar"
gh repo create scan-to-calendar --public --source . --push
gh api -X POST repos/{owner}/scan-to-calendar/pages -f "source[branch]=main" -f "source[path]=/"
```
The app is then at `https://<your-user>.github.io/scan-to-calendar/`.

**Cloudflare Pages.** Run `npx wrangler pages deploy . --project-name scan-to-calendar`.

All paths are relative, so the app works from a domain root or a sub-folder.

### Updating

Bump `VERSION` in `sw.js` whenever you change a file. Installed copies then pick up the new version the next time they open.

## Run locally

```bash
python3 -m http.server 8080
```
Open http://localhost:8080. The camera works on `localhost` without https. To try it on your phone, deploy it, because phones need https for the camera.

## Test

```bash
TZ=Africa/Lagos node --test test/*.test.js
```

## Install on a phone

- **iPhone:** open the URL in Safari, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** tap the **Install** button in the app, or use ⋮ → **Install app**.

## Known limits

- Google Calendar needs one tap on **Save**. Adding events with no tap at all would require Google sign-in (OAuth) and, for public use, Google's app verification.
- On iPhone, open the app in Safari or from the home screen. Browsers built into other apps (Instagram, Gmail and so on) may not pass the calendar file to Calendar.
- A QR code that only links to a web page (Eventbrite, Luma and similar) can't be read automatically, because a static page can't fetch other sites. The app shows the link so you can open it.

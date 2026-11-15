# Contributing to Scan to Calendar

Thanks for helping out. Scan to Calendar lets an admin turn an event into a QR code, project it during announcements, and lets anyone in the room scan it into **Google Calendar** or **Apple Calendar**, with reminders.

This guide covers how the project is put together, how to run and test it, and what to check before opening a pull request. For what the app does from a user's point of view, see the [README](README.md).

## Ground rules

These keep the app simple, private and easy to host. Please don't change them without discussing it in an issue first.

- **Static only.** Plain HTML, CSS and JavaScript. There is no server, no build step, no framework and no runtime npm dependencies. Every file is served as-is.
- **Nothing leaves the phone.** Scans, events and reminders stay in the browser. Event data travels in the `#…` part of links, which browsers never send to a server. Don't add analytics, trackers or calls to outside services.
- **Works offline.** The service worker (`sw.js`) caches every file the app needs.
- **Third-party code is vendored.** Libraries live in `vendor/` with their licences, not on a CDN. The page's Content Security Policy only allows scripts from the site itself.

## Getting started

You need a recent browser and Node.js 18 or later (only for the tests).

1. [Fork the repository](https://github.com/ehizman/scan-to-calendar/fork) on GitHub.
2. Clone your fork and serve it:

```bash
git clone https://github.com/<your-username>/scan-to-calendar.git
cd scan-to-calendar
git remote add upstream https://github.com/ehizman/scan-to-calendar.git
python3 -m http.server 8080
```

Open http://localhost:8080 for the scanner and http://localhost:8080/admin.html for the admin page. The camera works on `localhost` without https.

To try it on a phone you need https. The quickest way is a personal preview on [Netlify Drop](https://app.netlify.com/drop): drag the folder onto the page. QR codes made on `localhost` point to `localhost`, so phones can't open them; the admin page warns about this.

## How the code is organised

| File | What it does |
|---|---|
| `index.html`, `app.js` | Member page: camera scanning, the event view, the Google and Apple Calendar buttons, install prompt |
| `admin.html`, `admin.js` | Admin page: event form, QR drawing, reminder schedule, PNG/JPEG export, projection, saved events |
| `calendar.js` | All the logic that matters: reading QR contents, invite links, the reminder engine, building the Google link and the `.ics` file. Pure functions with no DOM access, unit-tested |
| `styles.css` | Styles for both pages, with light and dark themes |
| `sw.js` | Service worker: offline cache, and serving `.ics` files to iPhones (see below) |
| `vendor/jsQR.js` | QR decoder ([jsQR 1.4.0](https://github.com/cozmo/jsQR), Apache-2.0), used where the browser has no `BarcodeDetector` (Safari, Firefox) |
| `vendor/qrcode.js` | QR encoder ([qrcode-generator 1.4.4](https://github.com/kazuhikoarase/qrcode-generator), MIT) |
| `manifest.webmanifest`, `icons/` | Home-screen install details and icons |
| `test/` | Unit tests for `calendar.js` |

### Things worth knowing before you change them

- **QR formats.** The scanner reads iCalendar event data (`BEGIN:VEVENT`), Google Calendar "add event" links, Outlook "compose event" links, and the app's own invite links. Anything else is shown so the person can fill in the details. New formats go in `parseQR` in `calendar.js`, with tests.
- **Invite links.** The admin page packs the event into `#e=<base64url JSON>` (see `encodeInvite` / `decodeInvite`). The payload includes the moment the code was created, so every phone works out the same reminders. Old QR codes stay in circulation, so a change to the payload format needs a new version number (`v`), and the app must keep reading `v: 1`.
- **Reminders.** `computeReminders` decides the schedule from how far ahead the event was created (7+ days, 3–6, 1–2, under 1), then applies the morning, quiet-hours, already-passed and duplicate rules. The README lists the rules, and `test/reminders.test.js` pins each one down. Change the README table and the tests together with the code.
- **Apple Calendar on iPhone.** iOS Safari silently blocks `data:` links, so the app hands Safari the file at `./ics/<name>.ics?d=…`, which `sw.js` answers. Test any change here on a real iPhone.
- **Google Calendar** only gets the event, never reminders: its add-event link has no field for them.
- **Time zones.** Times are stored as local wall-clock strings (`YYYY-MM-DDTHH:mm`) plus an IANA time zone, and converted with `zonedToUtc`. Don't use `new Date("…")` on local strings; it silently uses the device's time zone.

## Coding conventions

- Classic `<script>` files, no modules or bundler. `calendar.js` exposes globals in the browser and `module.exports` for the tests; keep both working.
- **No inline scripts or event handlers** (`onclick=`…). The Content Security Policy blocks them.
- **Treat everything scanned as untrusted.** Put it on the page with `textContent` or by building DOM nodes, never with `innerHTML`.
- Colours come from the CSS custom properties at the top of `styles.css`. Check new UI in both light and dark mode, and at phone width (about 375px). The projection view and exported images stay black on white in both themes so they scan reliably.
- Keep user-facing text short and plain. Errors say what went wrong and what to do next.

## Testing

```bash
TZ=Africa/Lagos node --test test/*.test.js
```

The tests expect the `Africa/Lagos` time zone, so always run them with `TZ` set as shown. They cover parsing, invite links, every reminder rule and boundary, `.ics` output, and a full QR round trip (encode an image, then decode it).

GitHub Actions runs the same tests on Node 20 and 22 for every pull request and every push to `main` (`.github/workflows/test.yml`). A pull request needs them to pass. If it's your first pull request, a maintainer has to approve the run before it starts.

Before opening a pull request, also check by hand:

- [ ] Admin page: create an event, check the reminder schedule, project it, and download the PNG and JPEG.
- [ ] Member page: open the invite link, and tap both calendar buttons.
- [ ] Scanning works with the live camera and with an uploaded screenshot.
- [ ] If you changed anything for phones: tried it on an iPhone in Safari and on Android in Chrome, from a deployed https preview.
- [ ] Light and dark mode, and phone width.

## Making a change

1. Open an [issue](https://github.com/ehizman/scan-to-calendar/issues) first for anything bigger than a small fix, so we can agree on the approach.
2. Update your fork (`git pull upstream main`), create a branch from `main` in your fork, and keep each pull request to one change.
3. Add or update tests for any change to `calendar.js`.
4. **Bump `VERSION` in `sw.js`** whenever you change any file the app serves. Otherwise phones keep running the cached copy. Installed copies update on the second open after a deploy.
5. **Adding a file?** Add it to the `FILES` list in `sw.js`, or it won't work offline.
6. Update the README if you change what users see or how reminders behave.
7. Push the branch to your fork and open a pull request against `ehizman/scan-to-calendar` `main`. Describe what changed, why, and how you tested it, including which devices.

## Reporting a bug

Open an [issue](https://github.com/ehizman/scan-to-calendar/issues/new) with:

- the device and browser (for example "iPhone 15, Safari, from the home-screen icon")
- what you did and what happened instead
- for scanning problems, what the QR code contains if you can share it ("What the QR code contains" on the event view shows it)

## Good places to help

- **Google Calendar reminders.** Google's add-event link can't carry them; there may be a better approach that still needs no sign-in.
- **Event pages.** QR codes that only link to a page (Eventbrite, Luma and similar) can't be read, because a static site can't fetch other sites.
- **In-app browsers.** Browsers inside Instagram, WhatsApp, Gmail and similar apps may not pass the calendar file to Calendar.
- **Accessibility and translations.**

## Licence

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).

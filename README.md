# Scan to Calendar

Turn event announcements into calendar entries with one scan.

At church and other gatherings, announcements often go by too fast to remember every date and time. With Scan to Calendar, an organizer turns an event into a QR code and puts it on screen during the announcement. Everyone in the room scans it with their phone camera and adds the event to **Google Calendar** or **Apple Calendar**, with reminders.

**Try it:** https://idyllic-piroshki-9190da.netlify.app · **Create an event QR code:** https://idyllic-piroshki-9190da.netlify.app/admin.html

## How it works

### For organizers

1. Open the admin page and enter the event's title, date, start and end time, location, a short description, and time zone.
2. Tap **Create QR code**. The page shows the code and the reminders people will get.
3. Tap **Project on screen** for a full-screen, black-on-white view for the projector, or download the code as a **PNG** or **JPEG** for slides and flyers.

Events are saved in that browser, so you can project them again later.

### For everyone else

1. Point your phone camera at the projected QR code and open the link. No app or sign-up is needed.
2. Check the event details.
3. Tap **Google Calendar** (it opens with the event filled in; tap **Save**) or **Apple Calendar** (on iPhone the "Add to Calendar" sheet opens; on other devices you get an `.ics` file that works with most calendar apps, Outlook included).

The app can also scan other event QR codes: standard calendar event codes, Google Calendar links and Outlook links. Use **Scan QR code** on the home page, or upload a photo or screenshot of the code.

### Reminders

Reminders depend on how far ahead the event was created. All times are in the event's time zone.

| Created ahead of the start | Reminders |
|---|---|
| 7 days or more | 3 days before at 11:00 · 2 days before at 11:00 · event day at 12:00 · 1 hour before |
| 3 to under 7 days | 2 days before at 11:00 · 1 day before at 11:00 · 1 hour before |
| 1 to under 3 days | 1 day before at 11:00 · 1 hour before |
| under 1 day | 1 hour before · 15 minutes before |

Then:
- **Morning events** (starting before 1:00 PM) skip the event-day 12:00 reminder.
- **No reminders at night.** A reminder that would fall between 11:00 PM and 7:00 AM moves to 8:00 AM on the event day, or to 10:00 PM the night before if the event starts before 8:00 AM.
- Reminders that would already have passed when the code was created are skipped, and two reminders at the same time are kept once.

Reminders come with the event when it's added to Apple Calendar or opened from the `.ics` file. Google Calendar's add-event link can't carry reminders, so Google Calendar users get their usual Google reminders instead.

### Privacy

There's no server, account or tracking. The event travels inside the QR code's link, in the part after `#`, which browsers never send to a server. Scans, saved events and calendar files stay on the device.

The app can be installed to the home screen and works offline.

## Good to know

- On iPhone, open links in Safari or from the home-screen icon. Browsers inside other apps (Instagram, WhatsApp, Gmail and similar) may not hand the calendar file to Calendar.
- A QR code that only links to a web page (Eventbrite, Luma and similar) can't be read automatically. The app shows the link so you can open it and fill in the details.
- The admin page has no login. Anyone with the link can make a QR code, but nothing is stored on a server.

## Contributing

Want to help or run it yourself? See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, how the code is organised, testing, and how to send a pull request.

## Licence

[MIT](LICENSE)

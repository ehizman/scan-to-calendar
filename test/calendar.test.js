// Run with: TZ=Africa/Lagos node --test test/
// The expected values assume the Africa/Lagos time zone (UTC+1, no daylight saving).
const test = require("node:test");
const assert = require("node:assert/strict");
const cal = require("../calendar.js");

test("runs in the expected time zone", () => {
  assert.equal(cal.TZ_LOCAL, "Africa/Lagos", "run the tests with TZ=Africa/Lagos");
});

test("iCalendar event with TZID and escaped text", () => {
  const r = cal.parseQR("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Board meeting\\, Q4\nDTSTART;TZID=Europe/London:20261120T190000\nDTEND;TZID=Europe/London:20261120T203000\nLOCATION:HQ\\; Room 2\nDESCRIPTION:Line1\\nLine2\nEND:VEVENT\nEND:VCALENDAR");
  assert.equal(r.kind, "ical");
  assert.deepEqual(
    { s: r.ev.summary, l: r.ev.location, d: r.ev.description, tz: r.ev.tz, start: r.ev.start, end: r.ev.end },
    { s: "Board meeting, Q4", l: "HQ; Room 2", d: "Line1\nLine2", tz: "Europe/London", start: "2026-11-20T19:00", end: "2026-11-20T20:30" });
});

test("UTC start with DURATION and folded CRLF lines", () => {
  const r = cal.parseQR("BEGIN:VEVENT\r\nSUMMARY:Long \r\n title\r\nDTSTART:20261120T180000Z\r\nDURATION:PT90M\r\nEND:VEVENT");
  assert.equal(r.ev.summary, "Long title");
  assert.equal(r.ev.start, "2026-11-20T19:00");
  assert.equal(r.ev.end, "2026-11-20T20:30");
  assert.equal(r.ev.tz, "Africa/Lagos");
});

test("all-day event: exclusive DTEND becomes an inclusive last day", () => {
  const r = cal.parseQR("BEGIN:VEVENT\nSUMMARY:Conf\nDTSTART;VALUE=DATE:20261201\nDTEND;VALUE=DATE:20261203\nEND:VEVENT");
  assert.equal(r.ev.allDay, true);
  assert.equal(r.ev.start, "2026-12-01");
  assert.equal(r.ev.end, "2026-12-02");
});

test("no end time defaults to one hour", () => {
  const r = cal.parseQR("BEGIN:VEVENT\nSUMMARY:Quick\nDTSTART:20261120T235000\nEND:VEVENT");
  assert.equal(r.ev.end, "2026-11-21T00:50");
});

test("Google Calendar link with ctz", () => {
  const r = cal.parseQR("https://calendar.google.com/calendar/render?action=TEMPLATE&text=Lunch&dates=20261121T120000/20261121T130000&ctz=America/New_York&location=Ikoyi");
  assert.equal(r.kind, "link");
  assert.deepEqual([r.ev.summary, r.ev.tz, r.ev.start, r.ev.end, r.ev.location], ["Lunch", "America/New_York", "2026-11-21T12:00", "2026-11-21T13:00", "Ikoyi"]);
});

test("Google Calendar link in UTC", () => {
  const r = cal.parseQR("https://www.google.com/calendar/event?action=TEMPLATE&text=Call&dates=20261121T120000Z/20261121T130000Z");
  assert.deepEqual([r.ev.start, r.ev.end], ["2026-11-21T13:00", "2026-11-21T14:00"]);
});

test("Outlook link with offset", () => {
  const r = cal.parseQR("https://outlook.office.com/calendar/0/deeplink/compose?subject=Sync&startdt=2026-11-22T09:00:00%2B00:00&enddt=2026-11-22T09:30:00%2B00:00");
  assert.deepEqual([r.ev.summary, r.ev.start, r.ev.end], ["Sync", "2026-11-22T10:00", "2026-11-22T10:30"]);
});

test("other links and plain text", () => {
  assert.deepEqual(cal.parseQR("https://lu.ma/abc"), { kind: "url", url: "https://lu.ma/abc" });
  assert.deepEqual(cal.parseQR("Dinner Friday 7pm"), { kind: "text" });
  assert.equal(cal.parseQR("javascript:alert(1)").kind, "text");
});

test(".ics output for a timed event is in UTC", () => {
  const ev = { summary: "A, B; C", allDay: false, start: "2026-07-20T19:00", end: "2026-07-20T20:00", tz: "America/New_York", location: "", description: "x\ny", rrule: "FREQ=WEEKLY" };
  const ics = cal.toIcs(ev, "u1", new Date(Date.UTC(2026, 0, 1)));
  assert.match(ics, /\r\nDTSTART:20260720T230000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20260721T000000Z\r\n/);
  assert.match(ics, /\r\nSUMMARY:A\\, B\\; C\r\n/);
  assert.match(ics, /\r\nDESCRIPTION:x\\ny\r\n/);
  assert.match(ics, /\r\nRRULE:FREQ=WEEKLY\r\n/);
  assert.ok(ics.split("\r\n").every(l => l.length <= 75));
});

test(".ics output for an all-day event uses an exclusive end date", () => {
  const ics = cal.toIcs({ summary: "Conf", allDay: true, start: "2026-12-01", end: "2026-12-02", tz: "Africa/Lagos" }, "u2");
  assert.match(ics, /DTSTART;VALUE=DATE:20261201\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261203\r\n/);
});

test("Google link round-trips through the parser", () => {
  const ev = { summary: "Board & lunch", allDay: false, start: "2026-11-20T19:00", end: "2026-11-20T20:30", tz: "Europe/London", location: "HQ", description: "Notes", rrule: "" };
  const url = cal.googleCalendarUrl(ev);
  assert.ok(url.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE&"));
  const back = cal.parseQR(url).ev;
  assert.deepEqual([back.summary, back.tz, back.start, back.end, back.location, back.description], ["Board & lunch", "Europe/London", "2026-11-20T19:00", "2026-11-20T20:30", "HQ", "Notes"]);
  const allDay = cal.googleCalendarUrl({ summary: "Off", allDay: true, start: "2026-12-24", end: "2026-12-26" });
  assert.match(allDay, /dates=20261224%2F20261227/);
});

test("time zone conversion handles daylight saving", () => {
  assert.equal(cal.zonedToUtc("2026-11-20T19:00", "Europe/London").toISOString(), "2026-11-20T19:00:00.000Z");
  assert.equal(cal.zonedToUtc("2026-07-20T19:00", "Europe/London").toISOString(), "2026-07-20T18:00:00.000Z");
  assert.equal(cal.zonedToUtc("2026-07-20T19:00", "America/New_York").toISOString(), "2026-07-20T23:00:00.000Z");
});

// Run with: TZ=Africa/Lagos node --test test/
// Reminder schedule rules: see the comment above computeReminders in calendar.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const cal = require("../calendar.js");

const LAGOS = "Africa/Lagos"; // UTC+1 all year
// Local Lagos wall time -> Date
const at = local => cal.zonedToUtc(local, LAGOS);
// Reminder list -> local Lagos wall times, for readable assertions
const times = (list, tz = LAGOS) => list.map(r => cal.toLocalInput(r.at, tz));
const run = (start, created, tz = LAGOS) => cal.computeReminders({ start, tz }, cal.zonedToUtc(created, tz));

test("A: 7+ days ahead gives four reminders", () => {
  const r = run("2026-11-20T19:00", "2026-11-01T10:00");
  assert.equal(r.condition, "A");
  assert.deepEqual(times(r.reminders), ["2026-11-17T11:00", "2026-11-18T11:00", "2026-11-20T12:00", "2026-11-20T18:00"]);
  assert.deepEqual(r.dropped, []);
});

test("A: exactly 7 days counts as A", () => {
  assert.equal(run("2026-11-20T19:00", "2026-11-13T19:00").condition, "A");
  assert.equal(run("2026-11-20T19:00", "2026-11-13T19:01").condition, "B");
});

test("A: morning event drops the same-day 12:00 reminder", () => {
  const r = run("2026-11-20T10:00", "2026-11-01T10:00");
  assert.deepEqual(times(r.reminders), ["2026-11-17T11:00", "2026-11-18T11:00", "2026-11-20T09:00"]);
  assert.deepEqual(r.dropped.map(d => d.reason), ["morning"]);
});

test("A: 12:59 start is still a morning event; 13:00 is not", () => {
  assert.deepEqual(run("2026-11-20T12:59", "2026-11-01T10:00").dropped.map(d => d.reason), ["morning"]);
  const one = run("2026-11-20T13:00", "2026-11-01T10:00");
  // 12:00 fixed and 13:00 minus 1 hour are the same instant: kept once.
  assert.deepEqual(times(one.reminders), ["2026-11-17T11:00", "2026-11-18T11:00", "2026-11-20T12:00"]);
  assert.deepEqual(one.dropped.map(d => d.reason), ["duplicate"]);
});

test("B: 3 to 6 days ahead gives three reminders", () => {
  const r = run("2026-11-20T19:00", "2026-11-15T09:00");
  assert.equal(r.condition, "B");
  assert.deepEqual(times(r.reminders), ["2026-11-18T11:00", "2026-11-19T11:00", "2026-11-20T18:00"]);
  assert.equal(run("2026-11-20T19:00", "2026-11-17T19:00").condition, "B"); // exactly 3 days
});

test("C: 1 to 2 days ahead gives two reminders", () => {
  const r = run("2026-11-20T19:00", "2026-11-19T09:00");
  assert.equal(r.condition, "C");
  assert.deepEqual(times(r.reminders), ["2026-11-19T11:00", "2026-11-20T18:00"]);
  assert.equal(run("2026-11-20T19:00", "2026-11-19T19:00").condition, "C"); // exactly 1 day
});

test("C: 11:00 reminder already past at creation is dropped", () => {
  const r = run("2026-11-20T15:00", "2026-11-19T14:00");
  assert.equal(r.condition, "C");
  assert.deepEqual(times(r.reminders), ["2026-11-20T14:00"]);
  assert.deepEqual(r.dropped.map(d => d.reason), ["past"]);
});

test("D: under a day ahead gives 1 hour and 15 minutes before", () => {
  const r = run("2026-11-20T19:00", "2026-11-20T12:00");
  assert.equal(r.condition, "D");
  assert.deepEqual(times(r.reminders), ["2026-11-20T18:00", "2026-11-20T18:45"]);
});

test("D: reminder at or before creation time is dropped", () => {
  const r = run("2026-11-20T19:00", "2026-11-20T18:30");
  assert.deepEqual(times(r.reminders), ["2026-11-20T18:45"]);
  assert.deepEqual(r.dropped.map(d => d.reason), ["past"]);
  // Exactly equal to the creation time also drops (<=).
  assert.deepEqual(times(run("2026-11-20T19:00", "2026-11-20T18:00").reminders), ["2026-11-20T18:45"]);
});

test("Quiet hours: night reminder moves to 08:00 on the event day", () => {
  // 23:30 event: 1 hour before is 22:30 (fine); 15 min before is 23:15 (quiet) -> 08:00 that day.
  const r = run("2026-11-20T23:30", "2026-11-20T06:00");
  assert.equal(r.condition, "D");
  assert.deepEqual(times(r.reminders), ["2026-11-20T08:00", "2026-11-20T22:30"]);
  const moved = r.reminders.find(x => x.movedFrom);
  assert.equal(cal.toLocalInput(moved.movedFrom, LAGOS), "2026-11-20T23:15");
});

test("Quiet hours: 07:00 is outside quiet hours, 06:59 is inside", () => {
  assert.deepEqual(times(run("2026-11-20T08:00", "2026-11-19T20:00").reminders), ["2026-11-20T07:00", "2026-11-20T07:45"]);
  // 07:59 event: 1 hour before is 06:59 (quiet). 08:00 would be after the start, so 22:00 the night before.
  const r = run("2026-11-20T07:59", "2026-11-19T20:00");
  assert.deepEqual(times(r.reminders), ["2026-11-19T22:00", "2026-11-20T07:44"]);
  assert.deepEqual(r.dropped, []);
  const night = r.reminders.find(x => x.nightBefore);
  assert.equal(cal.toLocalInput(night.movedFrom, LAGOS), "2026-11-20T06:59");
});

test("Quiet hours: early-morning event moves night reminders to 22:00 the night before", () => {
  // 06:30 event: both reminders fall in quiet hours; both move to 22:00 the night before, kept once.
  const r = run("2026-11-20T06:30", "2026-11-19T20:00");
  assert.deepEqual(times(r.reminders), ["2026-11-19T22:00"]);
  assert.deepEqual(r.dropped.map(d => d.reason), ["duplicate"]);
  // 06:30 event booked 7+ days ahead: 11:00 reminders, no event-day 12:00, and 22:00 the night before.
  const a = run("2026-11-20T06:30", "2026-11-01T10:00");
  assert.deepEqual(times(a.reminders), ["2026-11-17T11:00", "2026-11-18T11:00", "2026-11-19T22:00"]);
  assert.deepEqual(a.dropped.map(d => d.reason), ["morning"]);
});

test("Quiet hours: just-after-midnight event", () => {
  // 00:30 event: 1 hour before is 23:30 (quiet) -> 08:00 is after the start -> 22:00 the evening before.
  const r = run("2026-11-21T00:30", "2026-11-20T10:00");
  assert.deepEqual(times(r.reminders), ["2026-11-20T22:00"]);
  assert.deepEqual(r.dropped.map(d => d.reason), ["duplicate"]);
});

test("Quiet hours: night-before fallback still has to be after creation", () => {
  // Created at 22:30 for a 06:30 event: 22:00 has already passed, so nothing is left.
  const r = run("2026-11-20T06:30", "2026-11-19T22:30");
  assert.deepEqual(r.reminders, []);
  assert.deepEqual(r.dropped.map(d => d.reason), ["past", "past"]);
});

test("Fixed times follow daylight saving in the event's time zone", () => {
  // London switches to BST on 29 Mar 2026. Fixed reminders stay at 11:00 local.
  const r = run("2026-03-30T10:00", "2026-03-01T09:00", "Europe/London");
  assert.deepEqual(times(r.reminders, "Europe/London"), ["2026-03-27T11:00", "2026-03-28T11:00", "2026-03-30T09:00"]);
  assert.equal(r.reminders[0].at.toISOString(), "2026-03-27T11:00:00.000Z"); // GMT
  assert.equal(r.reminders[2].at.toISOString(), "2026-03-30T08:00:00.000Z"); // BST
});

test("Reminders become calendar alarms (minutes before start)", () => {
  const ev = { start: "2026-11-20T19:00", tz: LAGOS };
  const r = cal.computeReminders(ev, at("2026-11-01T10:00"));
  assert.deepEqual(cal.alarmMinutes(ev, r.reminders), [3 * 1440 + 480, 2 * 1440 + 480, 420, 60]);
  assert.equal(cal.triggerDuration(3 * 1440 + 480), "-P3DT8H");
  assert.equal(cal.triggerDuration(60), "-PT1H");
  assert.equal(cal.triggerDuration(15), "-PT15M");
  assert.equal(cal.triggerDuration(1440), "-P1D");
  assert.equal(cal.triggerDuration(1505), "-P1DT1H5M");
});

test(".ics includes one VALARM per reminder", () => {
  const ics = cal.toIcs({ summary: "Meetup", allDay: false, start: "2026-11-20T19:00", end: "2026-11-20T21:00", tz: LAGOS, alarms: [60, 15] }, "u");
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.match(ics, /TRIGGER:-PT1H\r\n/);
  assert.match(ics, /TRIGGER:-PT15M\r\n/);
});

test("Invite links round-trip and reject bad input", () => {
  const ev = { summary: "Members' Night ✨", start: "2026-11-20T19:00", end: "2026-11-20T21:00", tz: LAGOS, location: "Hall A", description: "Bring ID" };
  const created = at("2026-11-01T10:07").getTime();
  const token = cal.encodeInvite(ev, created);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  const parsed = cal.parseQR("https://example.github.io/scan-to-calendar/#e=" + token);
  assert.equal(parsed.kind, "invite");
  assert.deepEqual([parsed.ev.summary, parsed.ev.start, parsed.ev.end, parsed.ev.tz, parsed.ev.location, parsed.ev.description],
    ["Members' Night ✨", "2026-11-20T19:00", "2026-11-20T21:00", LAGOS, "Hall A", "Bring ID"]);
  assert.equal(parsed.created.getTime(), created);
  // Same reminders on the member's phone as on the admin page.
  assert.deepEqual(times(cal.computeReminders(parsed.ev, parsed.created).reminders), times(cal.computeReminders(ev, new Date(created)).reminders));

  assert.equal(cal.decodeInvite("not-base64!"), null);
  assert.equal(cal.decodeInvite(Buffer.from(JSON.stringify({ v: 2 })).toString("base64url")), null);
  assert.equal(cal.decodeInvite(Buffer.from(JSON.stringify({ v: 1, t: "x", s: "2026-11-20T19:00", e: "2026-11-20T18:00", z: LAGOS, c: 1 })).toString("base64url")), null);
  assert.equal(cal.decodeInvite(Buffer.from(JSON.stringify({ v: 1, t: "x", s: "2026-11-20T19:00", e: "2026-11-20T20:00", z: "Mars/Base", c: 1 })).toString("base64url")), null);
  assert.equal(cal.parseQR("https://example.com/#e=garbage").kind, "url");
});

test("Invite QR code survives encoding and decoding as an image", () => {
  const qrcode = require("../vendor/qrcode.js");
  const jsQR = require("../vendor/jsQR.js");
  const ev = { summary: "Quarterly Members Meeting", start: "2026-12-05T18:00", end: "2026-12-05T20:30", tz: LAGOS,
    location: "Main Auditorium, 12 Example Road", description: "Doors open at 17:30. Bring your membership card." };
  const link = "https://example.github.io/scan-to-calendar/#e=" + cal.encodeInvite(ev, Date.now());
  const qr = qrcode(0, "M"); qr.addData(link); qr.make();
  const n = qr.getModuleCount(), scale = 4, quiet = 4, size = (n + quiet * 2) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  const out = jsQR(px, size, size);
  assert.ok(out, "QR decodes");
  assert.equal(out.data, link);
  assert.equal(cal.parseQR(out.data).ev.summary, "Quarterly Members Meeting");
});

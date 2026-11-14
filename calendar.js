/*
 * Scan to Calendar: event parsing and calendar export.
 * Pure functions with no DOM access. Loaded as a classic script in the browser
 * (functions become globals) and as a CommonJS module by the tests.
 *
 * Understands what event QR codes usually contain:
 *   - iCalendar event data (BEGIN:VEVENT ... END:VEVENT, with or without VCALENDAR)
 *   - Google Calendar "add event" links (action=TEMPLATE)
 *   - Outlook.com / Office 365 "compose event" links
 * Anything else is reported as a plain URL or plain text for the person to fill in.
 */

const TZ_LOCAL = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
})();

function validTz(tz) {
  if (!tz) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return null; }
}

function partsIn(d, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const o = {};
  f.formatToParts(d).forEach(x => { o[x.type] = x.value; });
  return o;
}

/** Date -> "YYYY-MM-DDTHH:mm" wall-clock time in `tz`. */
function toLocalInput(d, tz) {
  const o = partsIn(d, tz);
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;
}

/** "YYYY-MM-DDTHH:mm" wall-clock time in `tz` -> Date (UTC instant). */
function zonedToUtc(local, tz) {
  const [ds, ts] = local.split("T");
  const [y, mo, da] = ds.split("-").map(Number);
  const [h, mi] = ts.split(":").map(Number);
  const target = Date.UTC(y, mo - 1, da, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const o = partsIn(new Date(guess), tz);
    const seen = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
    if (seen === target) break;
    guess += target - seen;
  }
  return new Date(guess);
}

function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function addMsLocal(local, ms) {
  return new Date(new Date(local + ":00Z").getTime() + ms).toISOString().slice(0, 16);
}

/** iCalendar DURATION (e.g. PT1H30M, P1D) -> milliseconds, or null. */
function durMs(s) {
  const m = String(s || "").trim().match(/^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  return (+m[1] || 0) * 6048e5 + (+m[2] || 0) * 864e5 + (+m[3] || 0) * 36e5 + (+m[4] || 0) * 6e4 + (+m[5] || 0) * 1e3;
}

function unfold(s) { return s.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, ""); }
function icsUnescape(v) { return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"); }

/** {val, p} iCalendar date property -> {allDay, date} | {allDay:false, local, tz} | null. */
function parseIcsDate(prop) {
  if (!prop || !prop.val) return null;
  const v = prop.val.trim(), p = prop.p || {};
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}` };
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
  if (!m) return null;
  if (m[7]) {
    // A UTC time: show it in the viewer's own time zone.
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return { allDay: false, local: toLocalInput(d, TZ_LOCAL), tz: TZ_LOCAL };
  }
  return { allDay: false, local: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, tz: validTz(p.TZID) || TZ_LOCAL };
}

/**
 * Event model used by the app:
 *   { summary, allDay, start, end, tz, location, description, rrule, url }
 * Timed events: start/end are "YYYY-MM-DDTHH:mm" in `tz`.
 * All-day events: start/end are "YYYY-MM-DD" and `end` is the LAST day (inclusive).
 */
function eventFromProps(props) {
  const ev = {
    summary: props.SUMMARY?.val || "", location: props.LOCATION?.val || "",
    description: props.DESCRIPTION?.val || "", rrule: props.RRULE?.val || "", url: props.URL?.val || "",
  };
  const s = parseIcsDate(props.DTSTART);
  if (!s) { ev.start = null; ev.end = null; ev.allDay = false; ev.tz = TZ_LOCAL; return ev; }
  const e = parseIcsDate(props.DTEND || props.DUE);
  const dur = props.DURATION ? durMs(props.DURATION.val) : null;
  ev.allDay = s.allDay;
  if (s.allDay) {
    ev.tz = TZ_LOCAL;
    ev.start = s.date;
    let end = s.date;
    if (e && e.allDay) end = addDays(e.date, -1); // iCalendar DTEND is exclusive
    else if (dur) end = addDays(s.date, Math.max(0, Math.round(dur / 864e5) - 1));
    ev.end = end < ev.start ? ev.start : end;
  } else {
    ev.tz = s.tz;
    ev.start = s.local;
    if (e && !e.allDay) ev.end = e.tz === s.tz ? e.local : toLocalInput(zonedToUtc(e.local, e.tz), s.tz);
    else if (dur) ev.end = addMsLocal(s.local, dur);
    else ev.end = addMsLocal(s.local, 36e5);
    if (ev.end <= ev.start) ev.end = addMsLocal(s.local, 36e5);
  }
  return ev;
}

function parseVEvent(text) {
  const body = unfold(text);
  const m = body.match(/BEGIN:VEVENT\n?([\s\S]*?)(?:END:VEVENT|$)/i);
  const props = {};
  for (const line of (m ? m[1] : body).split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const key = name.trim().toUpperCase();
    if (key in props) continue;
    const p = {};
    params.forEach(x => {
      const j = x.indexOf("=");
      if (j > 0) p[x.slice(0, j).toUpperCase()] = x.slice(j + 1).replace(/^"|"$/g, "");
    });
    let val = line.slice(i + 1).trim();
    if (["SUMMARY", "LOCATION", "DESCRIPTION"].includes(key)) val = icsUnescape(val);
    props[key] = { val, p };
  }
  return eventFromProps(props);
}

/** ISO date/time from a calendar link -> iCalendar basic token (UTC when an offset is given). */
function isoToToken(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  if (/^\d{8}(T\d{4,6}Z?)?$/i.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.replace(/-/g, "");
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) {
    const d = new Date(v);
    if (isNaN(d)) return "";
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] || "00"}`;
}

function parseCalendarLink(u) {
  const host = u.hostname.toLowerCase(), q = u.searchParams;
  const prop = (val, p) => (val ? { val, p: p || {} } : undefined);
  if (/(^|\.)google\.com$/.test(host) && /calendar/i.test(host + u.pathname) && (q.get("action") || "").toUpperCase() === "TEMPLATE") {
    const ctz = validTz(q.get("ctz"));
    const [a, b] = (q.get("dates") || "").split("/");
    return eventFromProps({
      SUMMARY: prop(q.get("text")), DESCRIPTION: prop(q.get("details")), LOCATION: prop(q.get("location")),
      RRULE: prop((q.get("recur") || "").replace(/^RRULE:/i, "")),
      DTSTART: prop(a, { TZID: ctz }), DTEND: prop(b, { TZID: ctz }),
    });
  }
  if (/(^|\.)(outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com)$/.test(host) && /compose/i.test(u.pathname)) {
    const allDay = (q.get("allday") || "").toLowerCase() === "true";
    let a = isoToToken(q.get("startdt")), b = isoToToken(q.get("enddt"));
    if (allDay) { a = a.slice(0, 8); b = b.slice(0, 8); }
    return eventFromProps({
      SUMMARY: prop(q.get("subject")), DESCRIPTION: prop(q.get("body")), LOCATION: prop(q.get("location")),
      DTSTART: prop(a), DTEND: prop(b),
    });
  }
  return null;
}

/**
 * QR text -> { kind: "ical" | "link", ev }
 *          | { kind: "invite", ev, created }   (an event link made on the admin page)
 *          | { kind: "url", url } | { kind: "text" }
 */
function parseQR(raw) {
  const t = String(raw || "").trim();
  if (/BEGIN:VEVENT/i.test(t)) return { kind: "ical", ev: parseVEvent(t) };
  let u = null;
  try { u = new URL(t); } catch {}
  if (u && /^https?:$/.test(u.protocol)) {
    const inv = u.hash.startsWith("#e=") ? decodeInvite(u.hash.slice(3)) : null;
    if (inv) return { kind: "invite", ev: inv.ev, created: inv.created };
    const ev = parseCalendarLink(u);
    return ev ? { kind: "link", ev } : { kind: "url", url: t };
  }
  return { kind: "text" };
}

/* ---------- invite links (admin page -> member page) ---------- */
/*
 * The admin page puts the event in the link's #fragment, so it never reaches
 * a server: https://<host>/<path>/#e=<base64url JSON>
 *   { v: 1, t: title, s: "YYYY-MM-DDTHH:mm", e: "YYYY-MM-DDTHH:mm", z: time zone,
 *     l?: location, d?: details, c: created time in whole minutes since 1970 (UTC) }
 * `c` travels with the event so every phone works out the same reminders.
 */
const INVITE_LIMITS = { title: 120, location: 160, details: 400 };

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

/** Timed event + creation time (ms) -> link fragment token. */
function encodeInvite(ev, createdMs) {
  const p = { v: 1, t: ev.summary, s: ev.start, e: ev.end, z: ev.tz, c: Math.floor(createdMs / 6e4) };
  if (ev.location) p.l = ev.location;
  if (ev.description) p.d = ev.description;
  return b64urlEncode(JSON.stringify(p));
}

/** Link fragment token -> { ev, created: Date } or null when it isn't a valid invite. */
function decodeInvite(token) {
  let p;
  try { p = JSON.parse(b64urlDecode(String(token || ""))); } catch { return null; }
  const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!p || p.v !== 1 || typeof p.t !== "string" || !p.t.trim() || !LOCAL.test(p.s) || !LOCAL.test(p.e) || !validTz(p.z) || !Number.isInteger(p.c)) return null;
  if (p.e <= p.s) return null;
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    ev: { summary: str(p.t, INVITE_LIMITS.title), allDay: false, start: p.s, end: p.e, tz: p.z,
      location: str(p.l, INVITE_LIMITS.location), description: str(p.d, INVITE_LIMITS.details), rrule: "", url: "" },
    created: new Date(p.c * 6e4),
  };
}

/* ---------- reminders ---------- */
/*
 * Reminder schedule for events made on the admin page. All "local" times are in
 * the event's own time zone.
 *
 * lead_time_days = (event start - created) in days, fractional.
 *   A  >= 7 days : start-3d @ 11:00, start-2d @ 11:00, event day @ 12:00, start - 1h
 *   B  3 to <7   : start-2d @ 11:00, start-1d @ 11:00, start - 1h
 *   C  1 to <3   : start-1d @ 11:00, start - 1h
 *   D  < 1       : start - 1h, start - 15min
 *
 * Checks, in order, for each reminder:
 *   1. Same-day morning: event starts before 13:00 -> drop fixed reminders on the event day.
 *   2. Quiet hours: a relative reminder at 23:00-06:59 local moves to 08:00 on the event day.
 *      If 08:00 is at or after the start (events before 08:00), it moves to 22:00 the
 *      night before instead (agreed addition to the spec).
 *   3. After start (not in the spec): a reminder that would land at or after the event
 *      start is dropped. A safety net; rule 2's fallback keeps reminders before the start.
 *   4. Past time: a reminder at or before the creation time is dropped.
 *   5. Duplicates (not in the spec): two reminders at the same instant are kept once.
 */
const QUIET_FROM_MIN = 23 * 60, QUIET_UNTIL_MIN = 7 * 60, QUIET_MOVE_TO = "08:00", QUIET_FALLBACK = "22:00", MORNING_CUTOFF_MIN = 13 * 60;

function minutesOfDayIn(date, tz) { const o = partsIn(date, tz); return +o.hour * 60 + +o.minute; }

/**
 * @param ev      { start: "YYYY-MM-DDTHH:mm", tz }
 * @param created Date the event was created/saved
 * @returns { condition, leadDays, reminders: [{at: Date, kind, label, movedFrom?}], dropped: [{at, kind, label, reason}] }
 */
function computeReminders(ev, created) {
  const startMs = zonedToUtc(ev.start, ev.tz).getTime();
  const createdMs = created.getTime();
  const leadDays = (startMs - createdMs) / 864e5;
  const eventDay = ev.start.slice(0, 10);
  const eventMin = +ev.start.slice(11, 13) * 60 + +ev.start.slice(14, 16);

  const fixed = (daysBefore, hh) => ({
    kind: "fixed", daysBefore,
    label: daysBefore === 0 ? `Event day at ${hh}:00` : `${daysBefore} day${daysBefore > 1 ? "s" : ""} before at ${hh}:00`,
    at: zonedToUtc(`${addDays(eventDay, -daysBefore)}T${hh}:00`, ev.tz),
  });
  const rel = mins => ({ kind: "relative", label: mins >= 60 ? `${mins / 60} hour before` : `${mins} minutes before`, at: new Date(startMs - mins * 6e4) });

  let condition, planned;
  if (leadDays >= 7) { condition = "A"; planned = [fixed(3, 11), fixed(2, 11), fixed(0, 12), rel(60)]; }
  else if (leadDays >= 3) { condition = "B"; planned = [fixed(2, 11), fixed(1, 11), rel(60)]; }
  else if (leadDays >= 1) { condition = "C"; planned = [fixed(1, 11), rel(60)]; }
  else { condition = "D"; planned = [rel(60), rel(15)]; }

  const reminders = [], dropped = [];
  for (const r of planned) {
    if (r.kind === "fixed" && r.daysBefore === 0 && eventMin < MORNING_CUTOFF_MIN) { dropped.push({ ...r, reason: "morning" }); continue; }
    if (r.kind === "relative") {
      const m = minutesOfDayIn(r.at, ev.tz);
      if (m >= QUIET_FROM_MIN || m < QUIET_UNTIL_MIN) {
        r.movedFrom = r.at;
        r.at = zonedToUtc(`${eventDay}T${QUIET_MOVE_TO}`, ev.tz);
        if (r.at.getTime() >= startMs) { r.at = zonedToUtc(`${addDays(eventDay, -1)}T${QUIET_FALLBACK}`, ev.tz); r.nightBefore = true; }
      }
    }
    if (r.at.getTime() >= startMs) { dropped.push({ ...r, reason: "after-start" }); continue; }
    if (r.at.getTime() <= createdMs) { dropped.push({ ...r, reason: "past" }); continue; }
    if (reminders.some(k => k.at.getTime() === r.at.getTime())) { dropped.push({ ...r, reason: "duplicate" }); continue; }
    reminders.push(r);
  }
  reminders.sort((a, b) => a.at - b.at);
  return { condition, leadDays, reminders, dropped };
}

/** Reminder instants -> whole minutes before the event start (what calendar alarms use). */
function alarmMinutes(ev, reminders) {
  const startMs = zonedToUtc(ev.start, ev.tz).getTime();
  return reminders.map(r => Math.round((startMs - r.at.getTime()) / 6e4)).filter(m => m > 0);
}

/* ---------- export ---------- */

function icsEscape(v) { return String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function icsUtc(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function icsFold(line) {
  const out = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); }
  out.push(s);
  return out.join("\r\n");
}

/** Minutes before start -> iCalendar duration: 4335 -> "-P3DT15M", 60 -> "-PT1H", 1440 -> "-P1D". */
function triggerDuration(mins) {
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  let s = "-P" + (d ? d + "D" : "");
  if (h || m || !d) s += "T" + (h ? h + "H" : "") + (m || (!h && !d) ? m + "M" : "");
  return s;
}

/** Event -> .ics file text (times written in UTC, so no VTIMEZONE block is needed).
 *  `ev.alarms` (optional): minutes before the start for each reminder. */
function toIcs(ev, uid, now = new Date()) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Scan to Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + icsUtc(now)];
  if (ev.allDay) {
    L.push("DTSTART;VALUE=DATE:" + ev.start.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addDays(ev.end || ev.start, 1).replace(/-/g, ""));
  } else {
    L.push("DTSTART:" + icsUtc(zonedToUtc(ev.start, ev.tz)), "DTEND:" + icsUtc(zonedToUtc(ev.end, ev.tz)));
  }
  L.push("SUMMARY:" + icsEscape(ev.summary));
  if (ev.location) L.push("LOCATION:" + icsEscape(ev.location));
  if (ev.description) L.push("DESCRIPTION:" + icsEscape(ev.description));
  if (ev.rrule) L.push("RRULE:" + ev.rrule.replace(/[\r\n]/g, ""));
  for (const mins of ev.alarms || []) {
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(ev.summary), "TRIGGER:" + triggerDuration(mins), "END:VALARM");
  }
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.map(icsFold).join("\r\n") + "\r\n";
}

/** Event -> Google Calendar "add event" link, prefilled; the person taps Save. */
function googleCalendarUrl(ev) {
  const p = new URLSearchParams({ action: "TEMPLATE", text: ev.summary });
  if (ev.allDay) {
    p.set("dates", ev.start.replace(/-/g, "") + "/" + addDays(ev.end || ev.start, 1).replace(/-/g, ""));
  } else {
    const basic = local => local.replace(/[-:]/g, "") + "00";
    p.set("dates", basic(ev.start) + "/" + basic(ev.end));
    p.set("ctz", ev.tz);
  }
  if (ev.location) p.set("location", ev.location);
  if (ev.description) p.set("details", ev.description.length > 1500 ? ev.description.slice(0, 1497) + "…" : ev.description);
  if (ev.rrule) p.set("recur", "RRULE:" + ev.rrule);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TZ_LOCAL, validTz, toLocalInput, zonedToUtc, addDays, addMsLocal, durMs, parseIcsDate, parseVEvent,
    parseCalendarLink, parseQR, toIcs, googleCalendarUrl, encodeInvite, decodeInvite, computeReminders, alarmMinutes,
    triggerDuration, INVITE_LIMITS };
}

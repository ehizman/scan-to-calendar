/* Scan to Calendar admin: create an event QR code, show its reminder schedule, export it, project it.
 * Needs vendor/qrcode.js and calendar.js loaded first. Everything stays in this browser. */
(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("s2c:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("s2c:" + k, JSON.stringify(v)); } catch {} },
  };
  // Member links point at the scanner page that sits next to this admin page.
  const BASE = new URL("./", location.href.split("#")[0]).href;

  let current = null;    // the event shown in the preview: { id, ev, created, link }
  let editingId = null;  // id of a saved event being edited

  /* ---------- setup ---------- */
  const host = location.hostname;
  if (location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)$/.test(host) || /\.local$/.test(host) || /^(10|192\.168)\./.test(host)) {
    const w = $("#host-warn");
    w.hidden = false;
    w.replaceChildren(Object.assign(document.createElement("b"), { textContent: "Testing only. " }),
      document.createTextNode(`This page is running on ${location.protocol === "file:" ? "a local file" : host}, so its QR codes point there and members' phones can't open them. Deploy the app, then create codes from the deployed admin page.`));
  }
  const tzList = (Intl.supportedValuesOf && Intl.supportedValuesOf("timeZone")) || [];
  $("#tz-list").replaceChildren(...tzList.map(z => Object.assign(document.createElement("option"), { value: z })));
  $("#a-tz").value = TZ_LOCAL;
  $("#a-date").value = addDays(toLocalInput(new Date(), TZ_LOCAL).slice(0, 10), 7);

  /* ---------- form ---------- */
  function readAdmin() {
    const title = $("#a-title").value.trim(), date = $("#a-date").value, st = $("#a-start").value, et = $("#a-end").value;
    const tz = validTz($("#a-tz").value.trim());
    const location = $("#a-location").value.trim(), details = $("#a-details").value.trim();
    if (!title) return { error: "Give the event a title.", focus: "#a-title" };
    if (!date) return { error: "Pick the event date.", focus: "#a-date" };
    if (!st) return { error: "Set the start time.", focus: "#a-start" };
    if (!et) return { error: "Set the end time.", focus: "#a-end" };
    if (!tz) return { error: "That time zone isn't recognized. Pick one from the list, such as Africa/Lagos.", focus: "#a-tz" };
    const start = `${date}T${st}`;
    let end = `${date}T${et}`;
    if (end <= start) end = `${addDays(date, 1)}T${et}`; // ends after midnight
    if (zonedToUtc(start, tz).getTime() <= Date.now()) return { error: "That start time has already passed. Pick a later date or time.", focus: "#a-date" };
    return { ev: { summary: title, allDay: false, start, end, tz, location, description: details } };
  }

  function updateHints() {
    const st = $("#a-start").value, et = $("#a-end").value;
    let txt = "";
    if (st && et) {
      const [sh, sm] = st.split(":").map(Number), [eh, em] = et.split(":").map(Number);
      let mins = eh * 60 + em - (sh * 60 + sm);
      const nextDay = mins <= 0; if (nextDay) mins += 1440;
      txt = `Lasts ${Math.floor(mins / 60) ? Math.floor(mins / 60) + " h " : ""}${mins % 60 ? (mins % 60) + " min" : ""}`.trim() + (nextDay ? ", ending the next day" : "");
    }
    $("#a-dur").textContent = txt;
    const n = $("#a-details").value.length, c = $("#a-count");
    c.textContent = `${n} / ${INVITE_LIMITS.details}`; c.classList.toggle("over", n > 300);
  }
  ["#a-start", "#a-end", "#a-details"].forEach(id => $(id).addEventListener("input", updateHints));
  updateHints();

  /* ---------- QR ---------- */
  function makeQR(text) { const qr = qrcode(0, "M"); qr.addData(text); qr.make(); return qr; }

  function qrSvg(qr, label) {
    const n = qr.getModuleCount(), q = 4, size = n + q * 2;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const bg = document.createElementNS(SVG_NS, "rect");
    bg.setAttribute("width", size); bg.setAttribute("height", size); bg.setAttribute("fill", "#fff");
    let d = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) { c++; continue; }
        const s = c; while (c < n && qr.isDark(r, c)) c++;
        d += `M${s + q} ${r + q}h${c - s}v1h${s - c}z`;
      }
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#000");
    svg.append(bg, path);
    return svg;
  }

  /* ---------- formatting ---------- */
  function fmtIn(date, tz, opts) { return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(date); }
  function whenText(ev) {
    const s = zonedToUtc(ev.start, ev.tz), e = zonedToUtc(ev.end, ev.tz);
    const day = fmtIn(s, ev.tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const t = o => fmtIn(o, ev.tz, { hour: "numeric", minute: "2-digit" });
    const sameDay = ev.start.slice(0, 10) === ev.end.slice(0, 10);
    return `${day}, ${t(s)} – ${sameDay ? t(e) : fmtIn(e, ev.tz, { weekday: "short", hour: "numeric", minute: "2-digit" })}` + (ev.tz !== TZ_LOCAL ? ` (${ev.tz})` : "");
  }
  const shortWhen = (d, tz) => fmtIn(d, tz, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  /* ---------- preview ---------- */
  const COND = {
    A: "Created 7 or more days ahead, so 4 reminders are planned.",
    B: "Created 3 to 6 days ahead, so 3 reminders are planned.",
    C: "Created 1 to 2 days ahead, so 2 reminders are planned.",
    D: "Created less than a day ahead, so 2 reminders are planned.",
  };
  const REASON = {
    morning: "Skipped because the event starts before 1:00 PM",
    "after-start": "Skipped because it would land after the event starts",
    past: "Skipped because that time had already passed when the code was created",
    duplicate: "Skipped because another reminder is at the same time",
  };

  function showPreview(entry) {
    current = entry;
    const { ev } = entry;
    $("#preview-empty").hidden = true; $("#preview").hidden = false;
    $("#p-title").textContent = ev.summary;
    $("#p-when").textContent = whenText(ev);
    $("#p-where").textContent = ev.location;

    const qr = makeQR(entry.link);
    $("#qr-box").replaceChildren(qrSvg(qr, `QR code for ${ev.summary}`));
    $("#p-link").value = entry.link;
    $("#btn-open").href = entry.link;
    const n = qr.getModuleCount();
    $("#p-meta").textContent = `Created ${shortWhen(new Date(entry.created), ev.tz)}. ` +
      (n > 81 ? `This is a dense code (${n}×${n}). Shorten the details so phones at the back of the room can read it.` : `Code size ${n}×${n}, easy to scan from a distance.`);

    const sched = computeReminders(ev, new Date(entry.created));
    // Round down so the figure never crosses a rule boundary (6.98 days shows as 6.9, not 7.0).
    const lead = sched.leadDays < 1 ? `${Math.floor(sched.leadDays * 240) / 10} hours` : `${Math.floor(sched.leadDays * 10) / 10} days`;
    $("#sched-cond").textContent = `${COND[sched.condition]} (Created ${lead} before the start.)`;
    const rows = [...sched.reminders.map(r => ({ r, on: true })), ...sched.dropped.map(r => ({ r, on: false }))];
    $("#sched").replaceChildren(...rows.map(({ r, on }) => {
      const li = document.createElement("li"); if (!on) li.className = "off";
      const w = document.createElement("span"); w.className = "w"; w.textContent = shortWhen(r.at, ev.tz);
      const k = document.createElement("span"); k.className = "k";
      const moved = r.movedFrom && `, moved from ${fmtIn(r.movedFrom, ev.tz, { hour: "numeric", minute: "2-digit" })} (quiet hours)` + (r.nightBefore ? " to the night before, because 8:00 AM is after the start" : "");
      k.textContent = on ? r.label + (moved || "") : `${r.label}. ${REASON[r.reason]}`;
      const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = on ? "On" : "Skipped";
      li.append(w, tag, k); return li;
    }));
    if (!sched.reminders.length) $("#sched-cond").textContent += " None of them apply, so members get no reminders from this code.";

    if (matchMedia("(max-width: 860px)").matches) $("#preview-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("#btn-create").addEventListener("click", () => {
    const r = readAdmin();
    $("#a-err").textContent = r.error || "";
    if (r.error) { $(r.focus).focus(); return; }
    const created = Math.floor(Date.now() / 6e4) * 6e4; // whole minutes, so every phone computes the same reminders
    const entry = { id: editingId || Date.now().toString(36), ev: r.ev, created, link: BASE + "#e=" + encodeInvite(r.ev, created) };
    const list = store.get("admin-events", []).filter(e => e.id !== entry.id);
    list.unshift(entry);
    store.set("admin-events", list.slice(0, 50));
    editingId = entry.id; $("#btn-create").textContent = "Update QR code";
    renderSaved(); showPreview(entry);
  });

  function loadIntoForm(entry) {
    const { ev } = entry;
    $("#a-title").value = ev.summary; $("#a-date").value = ev.start.slice(0, 10);
    $("#a-start").value = ev.start.slice(11, 16); $("#a-end").value = ev.end.slice(11, 16);
    $("#a-tz").value = ev.tz; $("#a-location").value = ev.location || ""; $("#a-details").value = ev.description || "";
    editingId = entry.id; $("#btn-create").textContent = "Update QR code"; $("#a-err").textContent = "";
    updateHints();
  }

  /* ---------- export ---------- */
  function wrapLines(ctx, text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean), lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
  }

  function exportImage(type) {
    if (!current) return;
    const { ev } = current;
    const qr = makeQR(current.link), n = qr.getModuleCount(), q = 4;
    const scale = Math.max(8, Math.floor(1200 / (n + q * 2)));
    const W = (n + q * 2) * scale, pad = Math.round(W * 0.07), maxW = W - pad * 2;
    const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");

    // Lay out the caption first so the canvas can be sized to fit it.
    const blocks = [];
    if ($("#x-caption").checked) {
      const spec = [
        [ev.summary, 700, 0.058, "#111111"],
        [whenText(ev), 500, 0.038, "#111111"],
        [ev.location, 400, 0.034, "#444444"],
        ["Scan with your phone camera to add this to your calendar", 400, 0.028, "#2746D6"],
      ];
      for (const [text, weight, k, color] of spec) {
        if (!text) continue;
        const size = Math.round(W * k);
        ctx.font = `${weight} ${size}px ${FONT}`;
        blocks.push({ lines: wrapLines(ctx, text, maxW), size, weight, color });
      }
    }
    const captionH = blocks.reduce((h, b, i) => h + b.lines.length * b.size * 1.25 + (i ? Math.round(W * 0.018) : 0), 0);
    canvas.width = W;
    canvas.height = W + (blocks.length ? Math.round(captionH + pad * 1.1) : 0);

    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); // JPEG has no transparency
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + q) * scale, (r + q) * scale, scale, scale);

    let y = W - Math.round(scale * 1.5);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    blocks.forEach((b, i) => {
      if (i) y += Math.round(W * 0.018);
      ctx.font = `${b.weight} ${b.size}px ${FONT}`; ctx.fillStyle = b.color;
      for (const line of b.lines) { ctx.fillText(line, W / 2, y); y += b.size * 1.25; }
    });

    const mime = type === "jpeg" ? "image/jpeg" : "image/png", ext = type === "jpeg" ? "jpg" : "png";
    const name = (ev.summary.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event") + "-qr." + ext;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, mime, 0.95);
  }
  $("#btn-png").addEventListener("click", () => exportImage("png"));
  $("#btn-jpg").addEventListener("click", () => exportImage("jpeg"));

  $("#btn-copy").addEventListener("click", () => {
    const btn = $("#btn-copy"), done = t => { btn.textContent = t; setTimeout(() => { btn.textContent = "Copy link"; }, 1800); };
    const fallback = () => { const i = $("#p-link"); i.focus(); i.select(); done("Press Ctrl+C / ⌘C"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(current.link).then(() => done("Copied"), fallback);
    else fallback();
  });

  /* ---------- projection ---------- */
  const pj = $("#projector");
  let wakeLock = null, wentFullscreen = false, lastFocus = null;

  async function keepAwake() { try { wakeLock = await navigator.wakeLock.request("screen"); } catch { wakeLock = null; } }
  function project(entry) {
    const { ev } = entry;
    lastFocus = document.activeElement;
    $("#pj-qr").replaceChildren(qrSvg(makeQR(entry.link), `QR code for ${ev.summary}`));
    $("#pj-title").textContent = ev.summary;
    $("#pj-when").textContent = whenText(ev);
    $("#pj-where").textContent = ev.location;
    pj.hidden = false; document.body.style.overflow = "hidden";
    $("#pj-close").focus();
    wentFullscreen = false;
    if (pj.requestFullscreen) pj.requestFullscreen().then(() => { wentFullscreen = true; }, () => {});
    if ("wakeLock" in navigator) keepAwake();
  }
  function closeProjector() {
    if (pj.hidden) return;
    pj.hidden = true; document.body.style.overflow = "";
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("#btn-project").addEventListener("click", () => current && project(current));
  $("#pj-close").addEventListener("click", closeProjector);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !pj.hidden) closeProjector(); });
  // Esc in full screen leaves full screen first; treat that as closing the projection too.
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && wentFullscreen) { wentFullscreen = false; closeProjector(); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !pj.hidden && "wakeLock" in navigator && !wakeLock) keepAwake(); });

  /* ---------- saved events ---------- */
  function renderSaved() {
    const list = store.get("admin-events", []), ul = $("#saved");
    $("#saved-empty").hidden = list.length > 0;
    ul.replaceChildren(...list.map(entry => {
      const { ev } = entry;
      const ended = zonedToUtc(ev.end, ev.tz).getTime() < Date.now();
      const li = document.createElement("li"); if (ended) li.className = "past";
      const t = document.createElement("span"); t.className = "t"; t.textContent = ev.summary + (ended ? " (ended)" : "");
      const d = document.createElement("span"); d.className = "d"; d.textContent = whenText(ev);
      const row = document.createElement("span"); row.className = "row";
      const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = label; b.addEventListener("click", () => fn(b)); return b; };
      row.append(
        mk("Project", () => { showPreview(entry); project(entry); }),
        mk("Open", () => { loadIntoForm(entry); showPreview(entry); }),
        mk("Delete", b => {
          if (b.dataset.armed) {
            store.set("admin-events", store.get("admin-events", []).filter(e => e.id !== entry.id));
            if (editingId === entry.id) { editingId = null; $("#btn-create").textContent = "Create QR code"; }
            renderSaved();
          } else { b.dataset.armed = "1"; b.textContent = "Confirm delete"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Delete"; } }, 4000); }
        }),
      );
      li.append(t, row, d);
      return li;
    }));
  }
  renderSaved();

  // Typing a different title means a new event, not an edit of the open one.
  $("#a-title").addEventListener("change", () => {
    const list = store.get("admin-events", []), open = list.find(e => e.id === editingId);
    if (open && open.ev.summary !== $("#a-title").value.trim()) { editingId = null; $("#btn-create").textContent = "Create QR code"; }
  });
})();

/* Scan to Calendar: UI, camera scanning and calendar hand-off. Needs calendar.js and vendor/jsQR.js loaded first. */
(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("s2c:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("s2c:" + k, JSON.stringify(v)); } catch {} },
  };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMac = !isIOS && /Macintosh/.test(navigator.userAgent);
  const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  let current = null; // { raw, kind, source, url, hash, rrule }

  $("#tz-chip").textContent = TZ_LOCAL;
  if (!isIOS && !isMac) { $("#apple-label").textContent = "Apple, Outlook & others"; $("#apple-sub").textContent = "Downloads an .ics calendar file"; }
  else if (isMac) $("#apple-sub").textContent = "Downloads a file. Open it to add.";

  function setScanMsg(t, err) { const el = $("#scan-msg"); el.textContent = t || ""; el.classList.toggle("err", !!err); }

  /* ---------- live camera ---------- */
  const video = $("#video");
  let stream = null, scanning = false, detector = null, frameCanvas = null;

  async function startCamera() {
    setScanMsg("");
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanMsg("Live scanning needs the app to be opened over https. Use a photo or screenshot instead.", true);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      const name = e && e.name;
      setScanMsg(
        name === "NotAllowedError" || name === "SecurityError" ? "Camera access is blocked. Allow the camera for this site in your browser settings, or use a photo instead." :
        name === "NotFoundError" || name === "OverconstrainedError" ? "No camera was found. Use a photo or screenshot instead." :
        name === "NotReadableError" ? "Another app is using the camera. Close it and try again, or use a photo." :
        "The camera couldn't start. Use a photo or screenshot instead.", true);
      return;
    }
    video.srcObject = stream;
    $("#btn-scan").hidden = true; video.hidden = false; $("#live-bar").hidden = false; $("#finder").classList.add("live");
    try { await video.play(); } catch {}
    detector = null;
    if ("BarcodeDetector" in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] });
      } catch {}
    }
    scanning = true;
    tick();
  }

  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; video.srcObject = null;
    video.hidden = true; $("#live-bar").hidden = true; $("#btn-scan").hidden = false; $("#finder").classList.remove("live");
  }

  function jsqrFromSource(src, w0, h0, max, inversion) {
    if (!window.jsQR || !w0 || !h0) return null;
    const s = Math.min(1, max / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    frameCanvas = frameCanvas || document.createElement("canvas");
    frameCanvas.width = w; frameCanvas.height = h;
    const ctx = frameCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);
    const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: inversion });
    return r && r.data ? r.data : null;
  }

  async function tick() {
    if (!scanning) return;
    let raw = null;
    if (video.readyState >= 2) {
      if (detector) {
        try { const r = await detector.detect(video); raw = r && r[0] && r[0].rawValue; } catch {}
      } else {
        raw = jsqrFromSource(video, video.videoWidth, video.videoHeight, 720, "dontInvert");
      }
    }
    if (!scanning) return;
    if (raw) {
      stopCamera();
      if (navigator.vibrate) navigator.vibrate(40);
      loadRaw(raw, "scan");
      return;
    }
    setTimeout(() => requestAnimationFrame(tick), detector ? 90 : 160);
  }

  $("#btn-scan").addEventListener("click", startCamera);
  $("#btn-stop").addEventListener("click", stopCamera);
  document.addEventListener("visibilitychange", () => { if (document.hidden && scanning) stopCamera(); });

  /* ---------- photos, paste, example ---------- */
  async function loadBitmap(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {} }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("image")); };
      img.src = url;
    });
  }
  async function decodeFile(file) {
    const img = await loadBitmap(file);
    if ("BarcodeDetector" in window) {
      try { const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(img); if (r && r.length && r[0].rawValue) return r[0].rawValue; } catch {}
    }
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    for (const max of [1000, 1600, 700, 2400]) { const t = jsqrFromSource(img, w, h, max, "attemptBoth"); if (t) return t; }
    return null;
  }
  async function onFile(file) {
    if (!file) return;
    if (scanning) stopCamera();
    setScanMsg("Reading the code…");
    try {
      const raw = await decodeFile(file);
      if (!raw) { setScanMsg("No QR code found in that image. Crop or zoom in so the code fills more of the picture, and make sure it's in focus.", true); return; }
      loadRaw(raw, "photo");
    } catch {
      setScanMsg("That image couldn't be opened. Try a JPEG or PNG.", true);
    }
  }
  $("#pick").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; onFile(f); });
  $("#btn-text").addEventListener("click", () => { const t = $("#text-entry"); t.hidden = !t.hidden; if (!t.hidden) $("#raw-in").focus(); });
  $("#btn-read").addEventListener("click", () => {
    const v = $("#raw-in").value.trim();
    if (!v) { setScanMsg("Paste the QR code's contents first.", true); return; }
    loadRaw(v, "paste");
  });
  document.addEventListener("paste", e => {
    if (e.target && e.target.closest && e.target.closest("input, textarea")) return;
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const img = items.find(i => i.type.startsWith("image/"));
    if (img) { e.preventDefault(); onFile(img.getAsFile()); return; }
    const txt = e.clipboardData && e.clipboardData.getData("text");
    if (txt && txt.trim()) { e.preventDefault(); loadRaw(txt.trim(), "paste"); }
  });
  $("#btn-sample").addEventListener("click", () => {
    const d = new Date(); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7)); // next Thursday
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    loadRaw(["BEGIN:VEVENT", "SUMMARY:Example: Product Demo Night", `DTSTART:${ymd}T180000`, `DTEND:${ymd}T203000`,
      "LOCATION:Riverside Community Hall\\, Main Room", "DESCRIPTION:Example event loaded by Scan to Calendar. Doors open 17:45.", "END:VEVENT"].join("\n"), "example");
  });

  /* ---------- event view ---------- */
  function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  function loadRaw(raw, source) {
    const parsed = parseQR(raw);
    current = { raw, kind: parsed.kind, source, url: parsed.url || "", hash: hashStr(raw), created: parsed.created || null };
    const ev = parsed.ev || { summary: "", allDay: false, start: null, end: null, tz: TZ_LOCAL, location: "", description: "", rrule: "", url: "" };
    if (parsed.kind === "url" || parsed.kind === "text") ev.description = raw;
    if (ev.url && !ev.description.includes(ev.url)) ev.description = (ev.description ? ev.description + "\n\n" : "") + ev.url;
    current.rrule = ev.rrule || "";
    fillForm(ev);
    $("#raw-out").textContent = raw;
    $("#event").hidden = false; $("#steps").hidden = true;
    $("#add-google").classList.remove("done"); $("#add-apple").classList.remove("done"); $("#act-msg").textContent = "";
    $("#text-entry").hidden = true;
    setScanMsg(source === "example" ? "Example loaded. Nothing is added until you tap a calendar." : "");
    showNote(); render();

    const prev = store.get("history", []).find(h => h.hash === current.hash);
    if (prev && source !== "example") $("#act-msg").textContent = `You added this on ${new Date(prev.at).toLocaleDateString()}.`;
    $("#event").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  function fillForm(ev) {
    $("#f-title").value = ev.summary || "";
    setAllDay(!!ev.allDay, false);
    if (ev.start) { $("#f-start").value = ev.start; $("#f-end").value = ev.end || ev.start; }
    else {
      const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
      const s = toLocalInput(now, TZ_LOCAL); $("#f-start").value = s; $("#f-end").value = addMsLocal(s, 36e5);
    }
    $("#f-location").value = ev.location || ""; $("#f-notes").value = ev.description || ""; $("#f-tz").value = ev.tz || TZ_LOCAL;
  }

  function setAllDay(on, convert = true) {
    const s = $("#f-start"), e = $("#f-end"), sv = s.value, evv = e.value;
    $("#f-allday").checked = on;
    s.type = e.type = on ? "date" : "datetime-local";
    $("#tz-field").hidden = on;
    if (convert) {
      if (on) { s.value = (sv || "").slice(0, 10); e.value = (evv || sv || "").slice(0, 10); }
      else { const d = (sv || "").slice(0, 10); if (d) { s.value = d + "T09:00"; e.value = ((evv || sv).slice(0, 10) || d) + "T10:00"; } }
    }
  }
  $("#f-allday").addEventListener("change", e => { setAllDay(e.target.checked); render(); });
  ["#f-title", "#f-end", "#f-location", "#f-notes", "#f-tz"].forEach(id => $(id).addEventListener("input", render));
  $("#f-start").addEventListener("input", () => {
    const s = $("#f-start").value, e = $("#f-end").value;
    if (s && (!e || e < s)) $("#f-end").value = $("#f-allday").checked ? s : addMsLocal(s, 36e5);
    render();
  });

  function showNote() {
    const note = $("#parse-note"), link = $("#parse-note-link");
    link.hidden = true;
    if (current.kind === "url") {
      note.hidden = false;
      $("#parse-note-text").textContent = "This QR code links to a web page instead of holding the event itself. Open the page, then fill in the title and time below.";
      link.hidden = false; link.href = current.url; link.textContent = current.url;
    } else if (current.kind === "text") {
      note.hidden = false;
      $("#parse-note-text").textContent = "This QR code holds plain text. Fill in the title and time below.";
    } else note.hidden = true;
  }

  function fmt(local, opts) {
    const [d, t] = local.split("T"); const [y, m, da] = d.split("-").map(Number); const [h, mi] = (t || "00:00").split(":").map(Number);
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...opts }).format(new Date(Date.UTC(y, m - 1, da, h, mi)));
  }

  /** Read and check the form. Returns { ev } or { error, focus }. */
  function readForm() {
    const allDay = $("#f-allday").checked;
    const ev = {
      summary: $("#f-title").value.trim(), allDay, start: $("#f-start").value, end: $("#f-end").value || $("#f-start").value,
      location: $("#f-location").value.trim(), description: $("#f-notes").value.trim(),
      tz: allDay ? TZ_LOCAL : validTz($("#f-tz").value.trim()) || "", rrule: (current && current.rrule) || "",
    };
    if (!ev.summary) return { error: "Give the event a title.", focus: "#f-title" };
    if (!ev.start) return { error: "Set when the event starts.", focus: "#f-start" };
    if (!ev.tz) return { error: "That time zone isn't recognized. Use a name like Africa/Lagos or Europe/London.", focus: "#f-tz" };
    if (ev.end < ev.start) return { error: "The end is before the start.", focus: "#f-end" };
    if (!allDay && ev.end === ev.start) ev.end = addMsLocal(ev.start, 36e5);
    return { ev };
  }

  function whenLabel(ev) {
    if (ev.allDay) return fmt(ev.start, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) + (ev.end !== ev.start ? " – " + fmt(ev.end, { day: "numeric", month: "short" }) : "") + ", all day";
    return fmt(ev.start, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) + (ev.tz !== TZ_LOCAL ? ` (${ev.tz})` : "");
  }

  function render() {
    if (!current) return;
    const allDay = $("#f-allday").checked, s = $("#f-start").value, e = $("#f-end").value;
    $("#t-title").textContent = $("#f-title").value.trim() || "Untitled event";
    const labels = { ical: "Event data", link: "Calendar link", url: "Web link", text: "Plain text", invite: "Invitation" };
    const chip = $("#t-src");
    chip.textContent = current.source === "example" ? "Example" : labels[current.kind] || "Event";
    chip.classList.toggle("example", current.source === "example");
    if (s) {
      $("#t-mon").textContent = fmt(s, { month: "short" }); $("#t-day").textContent = fmt(s, { day: "numeric" }); $("#t-wd").textContent = fmt(s, { weekday: "short" });
      let when;
      if (allDay) when = e && e !== s ? `All day, until ${fmt(e, { weekday: "short", day: "numeric", month: "short" })}` : "All day";
      else {
        const sameDay = e && e.slice(0, 10) === s.slice(0, 10);
        when = `${fmt(s, { hour: "numeric", minute: "2-digit" })} – ${e ? fmt(e, sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "?"}`;
        const tz = $("#f-tz").value.trim(); if (tz && tz !== TZ_LOCAL) when += ` (${tz})`;
      }
      if (current.rrule) when += " · repeats";
      $("#t-when").textContent = when;
    } else { $("#t-mon").textContent = "—"; $("#t-day").textContent = "?"; $("#t-wd").textContent = ""; $("#t-when").textContent = "No date yet"; }
    $("#t-where").textContent = $("#f-location").value.trim();

    // Keep the Google link current so a tap opens it directly (no pop-up blocker involved).
    const r = readForm(), g = $("#add-google");
    if (r.ev) { g.href = googleCalendarUrl(r.ev); g.removeAttribute("aria-disabled"); }
    else { g.href = "#"; g.setAttribute("aria-disabled", "true"); }

    // Invitations from the admin page carry a reminder schedule.
    const rem = $("#t-rem"), list = r.ev ? remindersFor(r.ev) : [];
    rem.hidden = !list.length;
    if (list.length) {
      const fmtR = d => new Intl.DateTimeFormat(undefined, { timeZone: r.ev.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
      rem.replaceChildren(Object.assign(document.createElement("b"), { textContent: "Reminders" }),
        ...list.map(x => Object.assign(document.createElement("span"), { textContent: fmtR(x.at) })));
    }
    $("#google-sub").textContent = list.length ? "Opens it filled in. Tap Save. Uses your usual Google reminders." : "Opens it filled in. Tap Save.";
    if (isIOS || isMac) $("#apple-sub").textContent = list.length ? `Adds it with ${list.length} reminder${list.length > 1 ? "s" : ""}` : isMac ? "Downloads a file. Open it to add." : "Adds it with one tap";
  }

  /** Reminder schedule for admin-made invitations (none for other QR codes). */
  function remindersFor(ev) {
    if (!current || !current.created || ev.allDay) return [];
    return computeReminders(ev, current.created).reminders;
  }

  /* ---------- adding ---------- */
  function remember(ev, which) {
    const hist = store.get("history", []);
    const key = current.hash + "|" + ev.summary + "|" + ev.start;
    let h = hist.find(x => x.key === key);
    if (!h) { h = { key, hash: current.hash, at: Date.now(), summary: ev.summary, when: whenLabel(ev) }; hist.unshift(h); }
    h[which] = true; h.at = Date.now();
    store.set("history", hist.slice(0, 20));
    renderHistory();
  }

  $("#add-google").addEventListener("click", e => {
    const r = readForm();
    if (r.error) { e.preventDefault(); $("#act-msg").textContent = r.error; $(r.focus).focus(); return; }
    $("#add-google").classList.add("done");
    $("#act-msg").textContent = "Google Calendar opened in a new tab. Tap Save there to finish.";
    if (current.source !== "example") remember(r.ev, "google");
  });

  $("#add-apple").addEventListener("click", () => {
    const r = readForm();
    if (r.error) { $("#act-msg").textContent = r.error; $(r.focus).focus(); return; }
    const ev = { ...r.ev };
    ev.alarms = alarmMinutes(ev, remindersFor(ev));
    const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@scan-to-calendar`;
    const ics = toIcs(ev, uid);
    const name = (ev.summary.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event") + ".ics";
    if (isIOS) {
      $("#act-msg").textContent = "Opening Calendar… Tap Add to Calendar in the sheet that appears. If nothing opens, open this page in Safari and try again.";
      openIcsOnIOS(ics, name);
    } else {
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      $("#act-msg").textContent = isMac ? `Downloaded ${name}. Open it and Calendar adds the event.` : `Downloaded ${name}. Open it to add the event to your calendar app.`;
    }
    $("#add-apple").classList.add("done");
    if (current.source !== "example") remember(ev, "apple");
  });

  /**
   * iPhone/iPad: Safari silently ignores navigations to data: URLs, so open the file at a
   * real address instead. sw.js answers ./ics/<name>?d=… with the file as text/calendar,
   * and Safari hands that to Calendar. Without a service worker (some in-app browsers),
   * fall back to a blob: URL.
   */
  async function openIcsOnIOS(ics, name) {
    let reg = null;
    if ("serviceWorker" in navigator && window.isSecureContext) {
      reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 3000))]).catch(() => null);
    }
    if (reg && reg.active) {
      location.href = new URL(`ics/${encodeURIComponent(name)}?d=${b64urlEncode(ics)}`, location.href).href;
    } else {
      location.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    }
  }

  function renderHistory() {
    const hist = store.get("history", []), ul = $("#hist");
    ul.replaceChildren();
    $("#hist-empty").hidden = hist.length > 0;
    for (const h of hist) {
      const li = document.createElement("li");
      const t = document.createElement("span"); t.className = "t"; t.textContent = h.summary;
      const d = document.createElement("span"); d.className = "d"; d.textContent = h.when;
      const marks = document.createElement("span"); marks.className = "marks";
      if (h.google) { const m = document.createElement("span"); m.className = "mark"; m.textContent = "Google"; marks.append(m); }
      if (h.apple) { const m = document.createElement("span"); m.className = "mark"; m.textContent = isIOS || isMac ? "Apple" : ".ics"; marks.append(m); }
      li.append(t, marks, d); ul.append(li);
    }
  }
  renderHistory();

  /* ---------- invitation links (opened from a projected QR code) ---------- */
  function openInviteFromUrl() {
    if (!location.hash.startsWith("#e=")) return;
    if (parseQR(location.href).kind === "invite") loadRaw(location.href, "invite");
    else setScanMsg("This invitation link is damaged or incomplete. Scan the QR code again.", true);
  }
  window.addEventListener("hashchange", openInviteFromUrl);
  openInviteFromUrl();

  /* ---------- install + offline ---------- */
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferredPrompt = e;
    $("#install").hidden = false; $("#install-text").textContent = "Install Scan to Calendar for one-tap access from your home screen.";
    $("#btn-install").hidden = false;
  });
  $("#btn-install").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch {}
    deferredPrompt = null; $("#install").hidden = true;
  });
  if (isIOS && !isStandalone) {
    $("#install").hidden = false;
    $("#install-text").textContent = "To install, tap the Share button, then Add to Home Screen.";
  }
  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }
})();

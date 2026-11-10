// Shared helpers used by the popup, the settings page and the background worker.

export const DEFAULTS = {
  clientId: "", // Google OAuth Client ID (set in Settings, or in config.json)
  calendarName: "Canvas Assignments",
  eventMinutes: 60,
  reminders: "1440, 120",
  skipSubmitted: false,
  daysBack: 7,
  daysAhead: 120,
  courseLabel: "code", // "code" (BIO101) or "name" (Biology 101 / your nickname)
};

// Optional config.json next to manifest.json (not committed to git), e.g.
//   { "googleClientId": "1234-abc.apps.googleusercontent.com" }
// Lets you build your own Client ID into your copy so you never have to paste it.
let bundled;
export async function bundledConfig() {
  if (bundled) return bundled;
  try {
    const r = await fetch(chrome.runtime.getURL("config.json"));
    bundled = r.ok ? await r.json() : {};
  } catch {
    bundled = {};
  }
  return bundled;
}

export async function getSettings() {
  const [s, b] = await Promise.all([chrome.storage.sync.get(DEFAULTS), bundledConfig()]);
  const fromFile = String(b.googleClientId || "");
  if (!s.clientId && fromFile.endsWith(".apps.googleusercontent.com") && !fromFile.startsWith("PASTE")) {
    s.clientId = fromFile;
  }
  return s;
}

export function parseReminders(text) {
  return String(text || "")
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 40320)
    .slice(0, 5);
}

export function eventTitle(a) {
  return `${a.submitted ? "✅ " : ""}${a.course}: ${a.title}`;
}

export function eventTimes(a, minutes) {
  const end = new Date(a.due);
  const start = new Date(end.getTime() - Number(minutes || 0) * 60000);
  return { start, end };
}

export function eventDescription(a) {
  const due = new Date(a.due).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const lines = [`Due: ${due}`];
  if (a.points != null) lines.push(`Points: ${a.points}`);
  if (a.type && a.type !== "assignment") lines.push(`Type: ${a.type.replace(/_/g, " ")}`);
  if (a.url) lines.push(a.url);
  return lines.join("\n");
}

export function toGoogleEvent(a, s) {
  const { start, end } = eventTimes(a, s.eventMinutes);
  const ev = {
    summary: eventTitle(a),
    description: eventDescription(a),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    reminders: {
      useDefault: false,
      overrides: parseReminders(s.reminders).map((m) => ({ method: "popup", minutes: m })),
    },
    extendedProperties: { private: { source: "canvas", canvas_id: a.id } },
  };
  if (a.url) ev.source = { title: "Canvas", url: a.url };
  return ev;
}

// "Add to Google Calendar" link for one item. Needs no Google setup.
export function googleTemplateUrl(a, s) {
  const { start, end } = eventTimes(a, s.eventMinutes);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventTitle(a),
    dates: `${icsDate(start)}/${icsDate(end)}`,
    details: eventDescription(a),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// ---------- .ics export ----------
function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
}

// Fold lines at 75 bytes as RFC 5545 requires.
function icsFold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = "";
  for (const ch of line) {
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (enc.encode(cur + ch).length > limit) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildICS(items, s, host) {
  const now = icsDate(new Date());
  const reminders = parseReminders(s.reminders);
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Canvas to Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(s.calendarName)}`,
  ];
  for (const a of items) {
    const { start, end } = eventTimes(a, s.eventMinutes);
    out.push(
      "BEGIN:VEVENT",
      `UID:canvas-${a.id}@${host}`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(eventTitle(a))}`,
      `DESCRIPTION:${icsEscape(eventDescription(a))}`
    );
    if (a.url) out.push(`URL:${a.url}`);
    for (const m of reminders) {
      out.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(a.title)}`, `TRIGGER:-PT${m}M`, "END:VALARM");
    }
    out.push("END:VEVENT");
  }
  out.push("END:VCALENDAR");
  return out.map(icsFold).join("\r\n") + "\r\n";
}

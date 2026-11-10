// Background worker: signs in to Google and writes events to Google Calendar.
// This runs here, not in the popup, because the popup closes when the Google
// sign-in window opens.
import { getSettings, toGoogleEvent } from "./common.js";

const SCOPE = "https://www.googleapis.com/auth/calendar";
const API = "https://www.googleapis.com/calendar/v3";

let syncing = false; // only one sync (and one Google sign-in window) at a time

// Show a short welcome and setup page the first time the extension is installed.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html?welcome=1") });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "sync") {
    if (syncing) {
      reply({ started: false, busy: true });
      return;
    }
    syncing = true;
    runSync(msg.items)
      .catch(async (e) => {
        await setStatus({ state: "error", message: e.message || String(e) });
      })
      .finally(() => {
        syncing = false;
      });
    reply({ started: true });
  } else if (msg?.type === "signout") {
    chrome.storage.session.remove("gtoken").then(() => reply({ ok: true }));
    return true;
  }
});

async function setStatus(status) {
  await chrome.storage.session.set({ syncStatus: { ...status, at: Date.now() } });
}

// ---------- Google sign-in (works in Chrome, Edge, Brave, ...) ----------
async function getToken(forceNew = false) {
  if (!forceNew) {
    const { gtoken } = await chrome.storage.session.get("gtoken");
    if (gtoken && gtoken.exp > Date.now() + 60_000) return gtoken.value;
  }
  const { clientId } = await getSettings();
  if (!clientId) throw new Error("Add your Google OAuth Client ID in Settings first.");

  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: clientId.trim(),
      response_type: "token",
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: SCOPE,
      include_granted_scopes: "true",
    });
  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    const msg = e.message || String(e);
    if (/only one web auth flow/i.test(msg)) {
      throw new Error(
        "A Google sign-in window is already open (it may be an old error page). " +
          "Close that window, then click Sync again."
      );
    }
    if (/did not approve|user cancel|closed/i.test(msg)) {
      throw new Error("Google sign-in was closed before it finished. Click Sync to try again.");
    }
    throw new Error("Google sign-in failed: " + msg);
  }
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (params.get("error")) throw new Error("Google sign-in error: " + params.get("error"));
  const value = params.get("access_token");
  if (!value) throw new Error("Google didn't return an access token.");
  const exp = Date.now() + Number(params.get("expires_in") || 3600) * 1000;
  await chrome.storage.session.set({ gtoken: { value, exp } });
  return value;
}

async function gcal(token, method, path, { query, body } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    const err = new Error("AUTH");
    err.auth = true;
    throw err;
  }
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).error?.message || ""; } catch {}
    throw new Error(`Google Calendar ${r.status}: ${detail}`);
  }
  return r.status === 204 ? null : r.json();
}

async function findOrCreateCalendar(token, name) {
  if (name.trim().toLowerCase() === "primary") return "primary";
  let pageToken;
  do {
    const resp = await gcal(token, "GET", "/users/me/calendarList", { query: { pageToken } });
    const hit = (resp.items || []).find((c) => c.summary === name);
    if (hit) return hit.id;
    pageToken = resp.nextPageToken;
  } while (pageToken);
  const cal = await gcal(token, "POST", "/calendars", { body: { summary: name } });
  return cal.id;
}

async function existingEvents(token, calId) {
  const map = {};
  let pageToken;
  do {
    const resp = await gcal(token, "GET", `/calendars/${encodeURIComponent(calId)}/events`, {
      query: { privateExtendedProperty: "source=canvas", maxResults: 2500, showDeleted: "false", pageToken },
    });
    for (const ev of resp.items || []) {
      const cid = ev.extendedProperties?.private?.canvas_id;
      if (cid) map[cid] = ev;
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return map;
}

function changed(old, ev) {
  const t = (x) => (x ? new Date(x).getTime() : null);
  return (
    old.summary !== ev.summary ||
    (old.description || "") !== ev.description ||
    t(old.start?.dateTime) !== t(ev.start.dateTime) ||
    t(old.end?.dateTime) !== t(ev.end.dateTime)
  );
}

async function runSync(items) {
  const s = await getSettings();
  await setStatus({ state: "running", message: "Signing in to Google…" });

  let token = await getToken();
  const withRetry = async (fn) => {
    try {
      return await fn(token);
    } catch (e) {
      if (!e.auth) throw e;
      token = await getToken(true);
      return fn(token);
    }
  };

  await setStatus({ state: "running", message: `Finding calendar “${s.calendarName}”…` });
  const calId = await withRetry((t) => findOrCreateCalendar(t, s.calendarName));
  const existing = await withRetry((t) => existingEvents(t, calId));

  let created = 0, updated = 0, unchanged = 0, failed = 0;
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const ev = toGoogleEvent(a, s);
    const old = existing[a.id];
    try {
      if (!old) {
        await withRetry((t) => gcal(t, "POST", `/calendars/${encodeURIComponent(calId)}/events`, { body: ev }));
        created++;
      } else if (changed(old, ev)) {
        await withRetry((t) =>
          gcal(t, "PATCH", `/calendars/${encodeURIComponent(calId)}/events/${old.id}`, { body: ev })
        );
        updated++;
      } else unchanged++;
    } catch (e) {
      failed++;
      console.warn("Failed:", a.title, e);
    }
    if (i % 3 === 0 || i === items.length - 1) {
      await setStatus({ state: "running", message: `Syncing ${i + 1} of ${items.length}…` });
    }
  }

  await setStatus({
    state: failed ? "error" : "done",
    message:
      `“${s.calendarName}”: ` +
      [
        created && `${created} added`,
        updated && `${updated} updated`,
        unchanged && `${unchanged} already there`,
        failed && `${failed} failed (try again)`,
      ]
        .filter(Boolean)
        .join(", ") +
      ".",
    calendarName: s.calendarName,
  });
}

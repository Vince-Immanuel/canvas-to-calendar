import { getSettings, buildICS, googleTemplateUrl } from "./common.js";
import { fetchCanvasAssignments } from "./canvas-fetch.js";

const $ = (s) => document.querySelector(s);
const HOUR = 36e5;

let settings;
let all = [];              // every assignment loaded from Canvas
let checked = new Set();   // ids the user has ticked
let host = "canvas";

// ---------- small helpers ----------
function setStatus(text, kind = "", link) {
  const el = $("#status");
  el.hidden = !text;
  el.className = "status " + kind;
  el.textContent = text || "";
  if (link) {
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.textContent = link.text;
    el.append(" ", a);
  }
}

function showEmpty(text, openUrl) {
  $("#main").hidden = true;
  $("#empty").hidden = false;
  $("#emptyText").textContent = text;
  const btn = $("#openCanvas");
  btn.hidden = !openUrl;
  if (openUrl) {
    btn.textContent = `Open ${new URL(openUrl).hostname}`;
    btn.onclick = () => chrome.tabs.create({ url: openUrl });
  }
}

const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function fmtDay(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function dueTag(a) {
  const ms = new Date(a.due) - Date.now();
  if (a.submitted) return { text: "Submitted", cls: "tag-done" };
  if (ms < 0) return { text: "Past due", cls: "tag-late" };
  if (ms < 24 * HOUR) return { text: `Due in ${Math.max(1, Math.round(ms / HOUR))}h`, cls: "tag-soon" };
  return null;
}

// ---------- list ----------
function visible() {
  const course = $("#course").value;
  return all.filter((a) => (!course || a.course === course) && !(settings.skipSubmitted && a.submitted));
}

function selected() {
  return visible().filter((a) => checked.has(a.id));
}

function updateCount() {
  const vis = visible();
  const n = selected().length;
  $("#count").textContent = `${n} of ${vis.length} selected`;
  $("#sync").disabled = n === 0;
  $("#ics").disabled = n === 0;
  $("#sync").textContent = n ? `Add ${n} to Google Calendar` : "Add to Google Calendar";
  $("#all").checked = n > 0 && n === vis.length;
  $("#all").indeterminate = n > 0 && n < vis.length;
}

function render() {
  const list = $("#list");
  list.replaceChildren();
  const items = visible();
  if (!items.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = all.length ? "Nothing matches this filter." : "No assignments due in this date range. 🎉";
    list.append(div);
  }
  let lastDay = "";
  for (const a of items) {
    const due = new Date(a.due);
    const day = fmtDay(due);
    if (day !== lastDay) {
      const h = document.createElement("div");
      h.className = "day";
      h.textContent = day;
      list.append(h);
      lastDay = day;
    }
    const row = document.createElement("label");
    row.className = "item" + (a.submitted ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked.has(a.id);
    cb.addEventListener("change", () => {
      cb.checked ? checked.add(a.id) : checked.delete(a.id);
      updateCount();
    });

    const body = document.createElement("div");
    body.className = "body";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = a.title;
    title.title = a.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${a.course} · ${fmtTime(due)}` + (a.points != null ? ` · ${a.points} pts` : "");
    const tag = dueTag(a);
    if (tag) {
      const t = document.createElement("span");
      t.className = "tag " + tag.cls;
      t.textContent = tag.text;
      meta.append(" ", t);
    }
    body.append(title, meta);

    const add = document.createElement("a");
    add.className = "add";
    add.href = googleTemplateUrl(a, settings);
    add.target = "_blank";
    add.textContent = "+";
    add.title = "Add just this one to Google Calendar";
    add.setAttribute("aria-label", `Add ${a.title} to Google Calendar`);

    row.append(cb, body, add);
    list.append(row);
  }
  updateCount();
}

function fillCourseFilter() {
  const sel = $("#course");
  const current = sel.value;
  const courses = [...new Set(all.map((a) => a.course))].sort();
  sel.replaceChildren(new Option(`All courses (${all.length})`, ""));
  for (const c of courses) {
    sel.append(new Option(`${c} (${all.filter((a) => a.course === c).length})`, c));
  }
  if (courses.includes(current)) sel.value = current;
}

// ---------- loading ----------
async function load() {
  $("#main").hidden = true;
  $("#empty").hidden = true;
  setStatus("Loading your assignments…");
  const { lastCanvasOrigin } = await chrome.storage.local.get("lastCanvasOrigin");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const notCanvas = () => {
    setStatus("");
    showEmpty(
      lastCanvasOrigin
        ? "Open Canvas in this tab, then click the extension icon again."
        : "Go to your school's Canvas site (for example yourschool.instructure.com), log in, then click the extension icon again.",
      lastCanvasOrigin ? lastCanvasOrigin + "/" : null
    );
  };

  if (!tab || !/^https?:/.test(tab.url || "")) return notCanvas();

  let result;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchCanvasAssignments,
      args: [Number(settings.daysBack), Number(settings.daysAhead), settings.courseLabel],
    });
    result = res?.result;
  } catch {
    return notCanvas();
  }
  if (!result || result.error === "NOT_CANVAS") return notCanvas();
  if (result.error === "NOT_LOGGED_IN") {
    setStatus("");
    return showEmpty("You're not logged in to Canvas in this tab. Log in, then click the icon again.");
  }
  if (result.error) return setStatus(`Couldn't load assignments: ${result.error}`, "error");

  all = result.items;
  host = result.host;
  await chrome.storage.local.set({ lastCanvasOrigin: result.origin });
  $("#host").textContent = host;

  // Tick everything that's still to do; leave past and submitted work unticked.
  checked = new Set(all.filter((a) => !a.submitted && new Date(a.due) > Date.now()).map((a) => a.id));

  fillCourseFilter();
  $("#hideDone").checked = !!settings.skipSubmitted;
  setStatus("");
  $("#main").hidden = false;
  render();
  showSyncStatus((await chrome.storage.session.get("syncStatus")).syncStatus);
}

// ---------- sync status ----------
function showSyncStatus(st) {
  if (!st) return;
  const recent = Date.now() - st.at < 5 * 60_000;
  if (st.state === "running") {
    setStatus(st.message + " You can close this popup.");
    $("#sync").disabled = true;
  } else if (st.state === "done" && recent) {
    setStatus(`✓ ${st.message}`, "ok", { href: "https://calendar.google.com/", text: "Open Google Calendar ↗" });
  } else if (st.state === "error" && recent) {
    setStatus(st.message, "error");
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.syncStatus) {
    const st = changes.syncStatus.newValue;
    showSyncStatus(st);
    if (st?.state !== "running") updateCount();
  }
});

// ---------- events ----------
$("#course").addEventListener("change", render);

$("#hideDone").addEventListener("change", async (e) => {
  settings.skipSubmitted = e.target.checked;
  await chrome.storage.sync.set({ skipSubmitted: settings.skipSubmitted });
  render();
});

$("#all").addEventListener("change", (e) => {
  for (const a of visible()) e.target.checked ? checked.add(a.id) : checked.delete(a.id);
  render();
});

$("#sync").addEventListener("click", async () => {
  if (!settings.clientId) return chrome.runtime.openOptionsPage();
  $("#sync").disabled = true;
  setStatus("Starting… a Google sign-in window may open.");
  const res = await chrome.runtime.sendMessage({ type: "sync", items: selected() });
  if (res?.busy) {
    setStatus("A sync is already running. Finish or close the Google sign-in window, then try again.", "error");
    updateCount();
  }
});

$("#ics").addEventListener("click", () => {
  const ics = buildICS(selected(), settings, host);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `canvas-assignments-${new Date().toISOString().slice(0, 10)}.ics`;
  a.click();
  setStatus("Downloaded. To add it: Google Calendar → Settings → Import & export.", "ok", {
    href: "https://calendar.google.com/calendar/r/settings/export",
    text: "Open import page ↗",
  });
});

$("#refresh").addEventListener("click", load);
$("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#setupBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());

(async () => {
  settings = await getSettings();
  $("#setup").hidden = !!settings.clientId;
  await load();
})();

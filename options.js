import { DEFAULTS, getSettings, bundledConfig } from "./common.js";

const $ = (s) => document.querySelector(s);
const fields = Object.keys(DEFAULTS);
let savedTimer;

function readField(k) {
  const el = $("#" + k);
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") {
    const n = el.value === "" ? NaN : Number(el.value);
    return Number.isFinite(n) ? Math.max(0, n) : DEFAULTS[k];
  }
  const v = el.value.trim();
  return k === "clientId" ? v : v || DEFAULTS[k];
}

async function save(k) {
  await chrome.storage.sync.set({ [k]: readField(k) });
  $("#saved").hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("#saved").hidden = true), 1500);
  if (k === "clientId") await updateConnection();
}

async function updateConnection() {
  const s = await getSettings();
  const typed = $("#clientId").value.trim();
  const fromFile = (await bundledConfig()).googleClientId;
  const id = typed || s.clientId;
  const valid = /\.apps\.googleusercontent\.com$/.test(id);

  const badge = $("#connBadge");
  badge.textContent = valid ? "Ready ✓" : id ? "Check Client ID" : "Not set up";
  badge.className = "badge " + (valid ? "ok" : id ? "warn" : "");

  $("#clientHint").textContent = !typed && valid && fromFile
    ? "Using the Client ID from config.json."
    : id && !valid
      ? "This doesn't look like a Client ID. It should end in .apps.googleusercontent.com"
      : "A Client ID isn't a password. Never paste a client secret here.";

  $("#guide").open = !valid;
}

(async () => {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  for (const k of fields) {
    const el = $("#" + k);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!stored[k];
    else el.value = stored[k];
    el.addEventListener("change", () => save(k));
  }
  $("#redirect").textContent = chrome.identity.getRedirectURL();
  $("#welcome").hidden = !location.search.includes("welcome");
  await updateConnection();
})();

$("#clientId").addEventListener("input", updateConnection);

$("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#redirect").textContent);
  $("#copy").textContent = "Copied ✓";
  setTimeout(() => ($("#copy").textContent = "Copy"), 1500);
});

$("#signout").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "signout" });
  $("#signout").textContent = "Signed out ✓";
});

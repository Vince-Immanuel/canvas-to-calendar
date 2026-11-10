// This function is injected into your open Canvas tab (chrome.scripting.executeScript).
// It runs on the Canvas site itself, so it uses the session you're already logged in
// with. No access token is needed. It must stay self-contained: it can't use anything
// from outside its own body.
export async function fetchCanvasAssignments(daysBack, daysAhead, courseLabel) {
  const origin = location.origin;

  async function api(path) {
    let url = origin + "/api/v1" + path;
    const out = [];
    while (url) {
      const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
      if (r.status === 401) throw new Error("NOT_LOGGED_IN");
      if (!r.ok) throw new Error(`Canvas returned ${r.status} for ${path.split("?")[0]}`);
      // Canvas adds "while(1);" to session-authenticated JSON responses.
      const text = (await r.text()).replace(/^while\(1\);/, "");
      const data = JSON.parse(text);
      out.push(...(Array.isArray(data) ? data : [data]));
      const next = (r.headers.get("Link") || "").split(",").find((p) => /rel="next"/.test(p));
      url = next ? next.match(/<([^>]+)>/)[1] : null;
    }
    return out;
  }

  try {
    // Make sure this is really a Canvas site before going further.
    const isCanvas =
      document.querySelector('link[href*="instructure"], script[src*="instructure"], #application.ic-app') ||
      typeof window.ENV === "object" ||
      /instructure\.com$/.test(location.hostname);
    if (!isCanvas) {
      const probe = await fetch(origin + "/api/v1/users/self", { credentials: "include" }).catch(() => null);
      if (!probe || !probe.ok) throw new Error("NOT_CANVAS");
    }

    const now = Date.now();
    const start = new Date(now - daysBack * 864e5).toISOString();
    const end = new Date(now + daysAhead * 864e5).toISOString();

    const [courses, planner] = await Promise.all([
      api("/users/self/courses?enrollment_state=active&per_page=100"),
      api(`/planner/items?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=100&order=asc`),
    ]);

    const courseById = {};
    for (const c of courses) {
      if (!c || !c.id) continue;
      courseById[c.id] = courseLabel === "name" ? c.name || c.course_code : c.course_code || c.name;
    }

    const types = new Set(["assignment", "quiz", "discussion_topic", "sub_assignment"]);
    const items = [];
    const seen = new Set();
    for (const p of planner) {
      if (!types.has(p.plannable_type)) continue;
      const due = (p.plannable && p.plannable.due_at) || p.plannable_date;
      if (!due) continue;
      const id = `${p.plannable_type}-${p.plannable_id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const sub = p.submissions || {};
      items.push({
        id,
        type: p.plannable_type,
        title: (p.plannable && p.plannable.title) || "Untitled",
        course: courseById[p.course_id] || p.context_name || "Canvas",
        due,
        points: p.plannable && p.plannable.points_possible != null ? p.plannable.points_possible : null,
        url: p.html_url ? new URL(p.html_url, origin).href : "",
        submitted: !!(sub.submitted || sub.graded || sub.excused),
      });
    }
    items.sort((a, b) => new Date(a.due) - new Date(b.due));
    return { origin, host: location.hostname, items };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

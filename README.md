# Canvas to Calendar

A small browser extension that puts your **Canvas LMS assignments on your calendar**.

Open Canvas, click the icon, and see everything that's due, grouped by day. Tick the
assignments you want, then:

- **Add to Google Calendar**: adds them all in one click. Running it again updates
  changed due dates instead of making duplicates.
- **⤓ .ics**: downloads a calendar file for Google, Outlook or Apple Calendar. No setup.
- **+** next to an assignment: adds just that one to Google Calendar. No setup.

It reads assignments through the Canvas page you're already logged in to, so you don't
need a Canvas token. It works on any school's Canvas site, including custom addresses
like `canvas.yourschool.edu`, and runs fine alongside BetterCanvas.

## Features
- Assignments, quizzes and graded discussions from every active course
- Filter by course, hide submitted work, and see **Due in 5h** and **Past due** labels
- Events end at the due time, with reminders you choose (default: 1 day and 2 hours before)
- Submitted work is marked ✅ in event titles
- Puts everything on its own **Canvas Assignments** calendar (or your main one), so it's easy to show or hide
- Light and dark mode

## Install
The extension isn't on the Chrome Web Store, so you load it yourself (about 1 minute):

1. Download this repository: **Code → Download ZIP**, then unzip it. Or `git clone` it.
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Vivaldi: `vivaldi://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the unzipped folder (the one containing `manifest.json`).
5. Pin the extension from the puzzle-piece menu.

A welcome page opens with the next steps.

> Keep the folder where it is. The browser loads the extension from it.

## Connect Google Calendar (optional, about 5 minutes)
The **.ics** download and the **+** links work right away. The one-click **Add to Google
Calendar** button needs a free Google "Client ID", because Google requires every app
that writes to your calendar to have one.

Open the extension's **Settings** (⚙ in the popup). It has a step-by-step guide and
shows the exact redirect address to paste into Google. In short:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and
   turn on the **Google Calendar API**.
2. In **Google Auth Platform**, choose **External**, then add every Gmail address you'll
   sign in with as a **test user**.
3. Create an OAuth client of type **Web application**. Add the redirect URI shown in
   Settings (`https://<extension-id>.chromiumapp.org/`).
4. Paste the Client ID into Settings.

Optional: to build the Client ID into your copy, copy `config.example.json` to
`config.json` and put your ID in it. `config.json` is git-ignored.

## Troubleshooting
| Message | Fix |
|---|---|
| `Error 400: redirect_uri_mismatch` | The redirect URI in Google Cloud doesn't match this extension's ID. Copy the address from Settings into your OAuth client's **Authorized redirect URIs**. If you reinstall the extension in a different browser, add that browser's address too. |
| `Error 403: access_denied`, "has not completed the Google verification process" | The Google account you picked isn't a test user. Add it under **Google Auth Platform → Audience → Test users**. |
| "Google hasn't verified this app" | This is expected for an app you set up yourself. Click **Continue**. |
| "A Google sign-in window is already open" | Close any leftover Google sign-in or error windows, then click Sync again. |
| "This tab isn't a Canvas page" | Click the icon while a Canvas page is the active tab. |

Changes in Google Cloud can take a few minutes to start working.

## Privacy
- Everything runs in your browser. There's no server.
- Canvas data is read from the Canvas site you're logged in to and only sent to Google
  Calendar when you click **Add to Google Calendar**.
- The Google sign-in token is kept in browser session storage and cleared when the browser closes.
- Permissions: `activeTab` and `scripting` (read Canvas in the tab you clicked from),
  `identity` (Google sign-in), `storage` (settings), and `googleapis.com` (Calendar API).

## How it works
| File | Role |
|---|---|
| `manifest.json` | Extension setup (Manifest V3) |
| `canvas-fetch.js` | Runs in your Canvas tab and calls the Canvas planner and courses APIs with your session |
| `popup.*` | The list you see when clicking the icon |
| `background.js` | Google sign-in (`chrome.identity.launchWebAuthFlow`) and calendar create/update |
| `common.js` | Shared settings, event building, `.ics` export and Google links |
| `options.*` | Settings and setup guide |

Each Google event stores its Canvas ID in a private extended property, so re-syncing updates it instead of duplicating it.

## License
MIT. See [LICENSE](LICENSE).

Not affiliated with Instructure (Canvas), Google, or BetterCanvas.

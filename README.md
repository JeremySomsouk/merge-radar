# Merge Radar

A local dashboard of your open GitHub pull requests, sorted by what is blocking each merge.

![Merge Radar dashboard showing review requests, merge blockers, and quick actions for each pull request](docs/images/dashboard.png)

*Example dashboard with fictional repositories and pull requests.*

Merge Radar collects PRs you authored, are assigned to, or have been directly asked to review:

- **Needs my review**: personal or configured-team review requests, shown first with a link to the changed files.
- **Needs me**: merge conflict, failed CI, unresolved review threads, or changes requested.
- **Waiting on others**: CI running, review required, or branch protection pending.
- **Ready to merge**: no blockers detected in the fetched data.
- **Drafts**: collapsed, out of the way.

PRs opened by bots (for example an automation app that assigns PRs to you) are shown in their own section. The "Opened by me" section includes all other results, including PRs authored by another person and assigned to you. Blockers link to the relevant GitHub page, with a direct link to a failing check or unresolved thread when available. Merge Radar never writes to GitHub.

A PR that is both assigned to you and awaiting your review appears once, in "Needs my review". Use **Sync reviews** to refresh immediately, or let the normal auto-refresh keep the list current.

## Review sources

Choose a **Review source** in Settings:

- **Direct requests across GitHub** (default) uses [`user-review-requested:@me`](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests). It excludes team-only requests, applies your title keyword and extra filters, and keeps draft requests collapsed.
- **My repositories and teams** follows the selection logic used by `prctrl`: list every page of open PRs in your configured repositories, then match your GitHub username against `requested_reviewers` or a configured team against `requested_teams`. It excludes your own PRs, drafts, configured title prefixes, and PRs older than the configured age.

For repository mode, enter repositories as `owner/repository` and teams as `owner/team-slug`, separated by commas. Teams are matched only within their organization. The username comes from your active GitHub CLI account. This mode uses its own review scope; the dashboard's title keyword and extra search filters still apply to your authored and assigned PRs but do not hide incoming review requests.

Repository mode runs directly through `gh`, without requiring `prctrl` or reading its credentials. You can reuse the repository, team, age, and excluded-prefix values from your `prctrl` configuration in these settings. They are saved in the ignored `config.json`; changes to your `prctrl` configuration are not imported automatically. Browser snoozes remain specific to Merge Radar.

## Card actions

- **Review changes** opens the files changed in a PR awaiting your review.
- **Open failing check** opens the first non-ignored failed check, when present.
- **View feedback** opens the first unresolved thread, or the PR discussion when changes were requested.
- **Copy review request** copies a short message with the repository, PR number, title, and URL. Paste it into your chat or email when ready; the app does not send it.
- **Snooze until tomorrow** hides a PR from active sections and counts until 9 a.m. the next day in your browser's local timezone. Expand **Snoozed** to view it or choose **Restore** to bring it back early. Snoozes survive reloads in the same browser and automatically expire while the page is open.

Snoozing only affects this browser's dashboard. Other browsers or a different local port have separate snooze settings. "Copy links" excludes snoozed PRs.

## Requirements

- macOS or Linux
- Node.js 20 or later
- [GitHub CLI](https://cli.github.com/) logged in (`gh auth login`)

Merge Radar reuses your `gh` login and only reads data, so you don't need a new token or OAuth app.

## Run it

```bash
git clone https://github.com/JeremySomsouk/merge-radar.git
cd merge-radar
gh auth login
gh auth status
npm start
```

Open [localhost:4747](http://localhost:4747) in your browser. No `npm install` or build step is needed because the app uses only built-in Node.js modules. Stop the server with Ctrl+C.

Set `PORT` to use another port, for example `PORT=4848 npm start`. Run the tests with `npm test`.

## Run at login (macOS)

```bash
./install.sh     # installs a login agent and "Merge Radar.app" in ~/Applications
./uninstall.sh
```

Run these commands from the project folder after completing the setup above. Stop any manually started server on the same port first.

The agent keeps the server running in the background (logs go to `~/Library/Logs/merge-radar.log`). Open the dashboard with "Merge Radar" from Spotlight. Run `./install.sh` again if you move the project folder. The login installer is macOS-only; on Linux, start the server manually with `npm start`.

The app icon matches the logo and browser-tab icon in the dashboard. If you installed an earlier version, rerun `./install.sh` to update the app icon.

## Settings

The app works with the defaults immediately. To customize them, copy `config.example.json` to `config.json` (git-ignored), or click **Settings** in the page, which writes `config.json` for you. "Reset to defaults" copies the example file back.

| Setting | Default | Purpose |
| --- | --- | --- |
| Title keyword (`keyword`) | none | Only PRs whose title contains it, for example a team or ticket prefix |
| Extra GitHub filters (`extra`) | none | Any [search qualifiers](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests), for example `repo:owner/repo -label:wip` |
| Ignored checks (`ignore`) | none | Comma-separated parts of check names that never count as blockers |
| First section (`first`: `mine` or `bot`) | Opened by me | Which section comes first |
| Refresh every (`minutes`) | 3 minutes | Auto refresh interval |
| New review notifications (`reviewNotifications`) | Off | macOS background alerts for new review requests |
| Mark idle after (`idleDays`) | 3 days | PRs without updates for this long are faded and tagged |
| Review source (`reviewSource`) | `github` | Direct GitHub search, or `repositories` for repository and team matching |
| Review repositories (`reviewRepos`) | none | Comma-separated `owner/repository` names for repository mode |
| Review teams (`reviewTeams`) | none | Optional comma-separated `owner/team-slug` names for repository mode |
| Excluded review prefixes (`reviewExcludePrefixes`) | none | Comma-separated title prefixes skipped in repository mode |
| Maximum review age (`reviewMaxAgeDays`) | 60 days | Maximum age in complete days since creation, for repository mode |

Each lane in "Waiting on others" and "Ready to merge" has a **Copy links** button that copies a Markdown list of its PRs, ready to paste into a chat.

## Review notifications (macOS)

Install the optional helper with `brew install terminal-notifier`, then turn on **Settings > New review notifications** to receive a macOS alert when new PRs enter your review queue. The background server checks at your configured refresh interval, even with the dashboard closed. Keep the server running, or install the login agent above. Enabling or changing settings takes effect on the next scheduled check.

The first successful check establishes a quiet baseline. Later checks combine newly requested PRs into one count-only notification, without repository names or titles. Unchanged requests do not repeat, including after a restart. A request that leaves the queue and later returns can notify again. Changing the review scope establishes a fresh baseline. Failed syncs preserve the previous state and retry on the next check. Browser snoozes only affect the dashboard, not this background watcher.

Click a single-review notification to open that PR directly on GitHub. A notification for several new reviews opens the dashboard. Click actions use [terminal-notifier](https://github.com/julienXX/terminal-notifier). Allow its notifications in macOS System Settings if needed; Focus settings can silence alerts. The helper must be on the server's PATH. Missing-helper errors are logged and retried. Notifications are macOS-only and disabled by default.

## Privacy

The server listens only on `127.0.0.1`. The browser loads its assets from the local server, and the server calls GitHub through your existing `gh` login. The app has no analytics or third-party scripts and does not save full PR responses to disk. Notification tracking stores review URLs and the review scope in git-ignored `notification-state.json`, without PR titles or contents. Settings are saved locally in `config.json`; GitHub CLI manages your credentials separately. Snoozed PR URLs and wake-up times are stored in your browser's local storage, with no titles or PR contents.

Local settings, session artifacts, environment files, keys, and logs are excluded by `.gitignore`. Keep organization names, team filters, and repository-specific settings in `config.json`; use generic values in `config.example.json`. Review screenshots and copied PR links before sharing them because they can contain private repository names and PR titles.

## Limitations and troubleshooting

- Each refresh searches up to 50 authored and 50 assigned PRs. Direct-review search also stops at 50; repository mode paginates all open PRs in its configured repositories. Both modes fetch PR metadata, merge status, checks, and review threads in separate requests and paginate checks on the latest commit and review threads. Detail pages start at 20 items and shrink automatically if GitHub reports a query resource limit.
- PR detail fetching and repository listing each limit their batches to eight concurrent requests and shares in-progress syncs across tabs using the same settings. If a repository cannot be read, the refresh shows an error and keeps the previous dashboard instead of silently hiding reviews.
- "Ready to merge" is advisory. Confirm the current checks, approvals, and repository rules on GitHub before merging. Ignored checks do not count as blockers in this dashboard.
- If authentication fails or a private repository is missing, run `gh auth status` and check that your CLI account has access, including any required organization SSO authorization.
- If the port is already in use, stop the existing server or set a different `PORT`. If the macOS login agent fails to start, check `~/Library/Logs/merge-radar.log` and rerun `./install.sh` with Node.js and `gh` available in your terminal.

## How it works

- `server.mjs` serves the page and `/api/prs`, which searches authored and assigned PRs and loads reviews from the selected source.
- `reviews.mjs` paginates repository review requests and fetches their current checks and feedback through GitHub GraphQL.
- `notifications.mjs` detects new review requests, persists the local baseline, and sends count-only macOS notifications.
- `lib.mjs` classifies each PR into a lane. It is pure and covered by `lib.test.mjs`.
- `ui-state.mjs` handles local snooze expiry and review-request text, covered by `ui-state.test.mjs`.
- `index.html` is the whole UI, with no build step and no dependencies.

## License

[MIT](LICENSE)

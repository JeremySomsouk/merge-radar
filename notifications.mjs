import { readFile, writeFile, rename } from 'node:fs/promises';

export function reviewSnapshot(prs, config) {
  const scope = JSON.stringify([config.reviewSource, config.reviewSource === 'repositories'
    ? [config.reviewRepos, config.reviewTeams, config.reviewExcludePrefixes, config.reviewMaxAgeDays]
    : [config.keyword, config.extra]]);
  return { scope, urls: [...new Set(prs.filter((pr) => pr.source === 'review' && pr.lane !== 'draft').map((pr) => pr.url))] };
}

export function newReviewUrls(previous, current) {
  if (previous?.scope !== current.scope || !Array.isArray(previous.urls)) return [];
  const known = new Set(previous.urls);
  return current.urls.filter((url) => !known.has(url));
}

export async function checkReviewNotifications({ prs, config, file, notify }) {
  const current = reviewSnapshot(prs, config);
  let previous;
  try { previous = JSON.parse(await readFile(file, 'utf8')); }
  catch (err) { if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err; }
  const urls = newReviewUrls(previous, current);
  if (urls.length) await notify(urls);
  const temporary = file instanceof URL ? new URL(`${file.href}.tmp`) : `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(current), { mode: 0o600 });
  await rename(temporary, file);
  return urls.length;
}

export async function notifyMac(run, urls, dashboardUrl) {
  const count = urls.length;
  if (!count) return;
  const target = count === 1 && /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/.test(urls[0])
    ? urls[0] : dashboardUrl;
  await run('terminal-notifier', ['-title', 'Merge Radar', '-message',
    `${count} new pull request${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} your review. Click to ${count === 1 ? 'review on GitHub' : 'open Merge Radar'}.`,
    '-open', target], { timeout: 15000 });
}

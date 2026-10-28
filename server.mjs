import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { PR_FIELDS, preparePrs } from './lib.mjs';
import { findRepositoryReviews, hydrateReviews } from './reviews.mjs';
import { checkReviewNotifications, notifyMac } from './notifications.mjs';

const run = promisify(execFile);
const PORT = Number(process.env.PORT ?? 4747);
const CONFIG = new URL('./config.json', import.meta.url);
const EXAMPLE_CONFIG = new URL('./config.example.json', import.meta.url);
const ASSETS = new Map([
  ['/assets/logo.png', ['assets/logo.png', 'image/png']],
  ['/favicon.png', ['assets/favicon.png', 'image/png']],
  ['/ui-state.mjs', ['ui-state.mjs', 'text/javascript']],
]);
const QUERY = `query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ${PR_FIELDS} } } }`;
const pendingLoads = new Map();
const NOTIFICATION_STATE = new URL('./notification-state.json', import.meta.url);

async function pollNotifications() {
  let minutes = 3;
  try {
    const config = await loadConfig();
    minutes = Math.max(1, Math.min(60, Number(config.minutes) || 3));
    if (config.reviewNotifications === true && process.platform === 'darwin') {
      const prs = await syncPrs(config);
      if (JSON.stringify(await loadConfig()) !== JSON.stringify(config)) return;
      await checkReviewNotifications({
        prs, config, file: NOTIFICATION_STATE,
        notify: (urls) => notifyMac(run, urls, `http://localhost:${PORT}`),
      });
    }
  } catch {
    console.error('Review notification sync failed; will retry on the next refresh.');
  } finally {
    setTimeout(pollNotifications, minutes * 60000).unref();
  }
}

async function search(keyword, extra, filter) {
  const title = keyword ? `"${keyword}" in:title` : '';
  const q = `is:open is:pr archived:false ${title} sort:updated-desc ${extra} ${filter}`;
  const { stdout } = await run('gh', ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=${q}`], { maxBuffer: 20e6 });
  return JSON.parse(stdout).data.search.nodes;
}

async function loadConfig() {
  const defaults = JSON.parse(await readFile(EXAMPLE_CONFIG, 'utf8'));
  try {
    return { ...defaults, ...JSON.parse(await readFile(CONFIG, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') return defaults;
    throw err;
  }
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

async function loadPrs(config) {
  let { keyword, extra, ignore, reviewSource } = config;
  if (!['github', 'repositories'].includes(reviewSource)) throw new Error('Choose a valid review source in Settings.');
  keyword = keyword.replace(/"/g, '').trim();
  const ignoredChecks = ignore.split(',').map((s) => s.trim()).filter(Boolean);
  const [assigned, authored, requested] = await Promise.all([
    search(keyword, extra, 'assignee:@me'),
    search(keyword, extra, 'author:@me'),
    reviewSource === 'repositories' ? findRepositoryReviews(run, config) : search(keyword, extra, 'user-review-requested:@me'),
  ]);
  const reviews = reviewSource === 'repositories' ? await hydrateReviews(run, requested, [...assigned, ...authored]) : requested;
  return preparePrs({ assigned, authored, requested: reviews }, ignoredChecks);
}

function syncPrs(config) {
  const key = JSON.stringify(config);
  if (!pendingLoads.has(key)) pendingLoads.set(key, loadPrs(config).finally(() => pendingLoads.delete(key)));
  return pendingLoads.get(key);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (ASSETS.has(url.pathname)) {
      const [file, contentType] = ASSETS.get(url.pathname);
      const body = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, { 'content-type': contentType });
      return res.end(body);
    }
    if (url.pathname === '/api/prs') {
      const prs = await syncPrs(await loadConfig());
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(prs));
    }
    if (url.pathname === '/api/config') {
      // Requiring a JSON content type forces a CORS preflight, so other sites cannot write the config.
      if (req.method === 'PUT' && req.headers['content-type'] === 'application/json') {
        await writeFile(CONFIG, `${JSON.stringify(await readBody(req), null, 2)}\n`);
      } else if (req.method === 'DELETE') {
        await writeFile(CONFIG, await readFile(EXAMPLE_CONFIG));
      }
      const config = await loadConfig();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(config));
    }
    const page = await readFile(new URL('./index.html', import.meta.url));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err.stderr || err.message));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`merge-radar on http://localhost:${PORT}`));

pollNotifications();

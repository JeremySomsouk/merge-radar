import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { PR_FIELDS, classify, dedupe } from './lib.mjs';

const run = promisify(execFile);
const PORT = Number(process.env.PORT ?? 4747);
const CONFIG = new URL('./config.json', import.meta.url);
const EXAMPLE_CONFIG = new URL('./config.example.json', import.meta.url);
const QUERY = `query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ${PR_FIELDS} } } }`;

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

async function loadPrs({ keyword, extra, ignore }) {
  keyword = keyword.replace(/"/g, '').trim();
  const ignoredChecks = ignore.split(',').map((s) => s.trim()).filter(Boolean);
  const [assigned, authored] = await Promise.all([search(keyword, extra, 'assignee:@me'), search(keyword, extra, 'author:@me')]);
  return dedupe([...assigned, ...authored])
    .map((pr) => classify(pr, ignoredChecks))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/prs') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await loadPrs(await loadConfig())));
    }
    if (url.pathname === '/api/config') {
      // Requiring a JSON content type forces a CORS preflight, so other sites cannot write the config.
      if (req.method === 'PUT' && req.headers['content-type'] === 'application/json') {
        await writeFile(CONFIG, `${JSON.stringify(await readBody(req), null, 2)}\n`);
      } else if (req.method === 'DELETE') {
        await writeFile(CONFIG, await readFile(EXAMPLE_CONFIG));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await loadConfig()));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(new URL('./index.html', import.meta.url)));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err.stderr || err.message));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`merge-radar on http://localhost:${PORT}`));

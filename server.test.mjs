import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const fixturePr = (number, extra = {}) => ({
  number, title: `DEMO change ${number}`, url: `https://github.com/demo/app/pull/${number}`,
  isDraft: false, updatedAt: '2026-10-28T00:00:00Z', mergeable: 'MERGEABLE',
  reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', repository: { nameWithOwner: 'demo/app' },
  author: { __typename: 'User' }, commits: { nodes: [] }, reviewThreads: { nodes: [] }, ...extra,
});

test('server fetches direct review requests, deduplicates them and serves browser modules', { timeout: 15000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'merge-radar-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of ['server.mjs', 'lib.mjs', 'index.html', 'ui-state.mjs', 'config.example.json']) {
    await cp(new URL(file, import.meta.url), join(dir, file));
  }
  await mkdir(join(dir, 'bin'));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ keyword: 'DEMO', extra: 'repo:demo/app', ignore: '' }));
  const requested = fixturePr(2);
  await writeFile(join(dir, 'fixtures.json'), JSON.stringify({
    'assignee:@me': [requested],
    'author:@me': [fixturePr(1)],
    'user-review-requested:@me': [requested, fixturePr(3, { isDraft: true })],
  }));
  await writeFile(join(dir, 'bin', 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'api' || args[1] !== 'graphql') process.exit(2);
const query = args.find(arg => arg.startsWith('q=')).slice(2);
fs.appendFileSync('queries.log', query + '\\n');
const filter = query.split(' ').at(-1);
const nodes = JSON.parse(fs.readFileSync('fixtures.json', 'utf8'))[filter];
if (!nodes) process.exit(3);
console.log(JSON.stringify({ data: { search: { nodes } } }));
`, { mode: 0o755 });
  // Port zero avoids collisions with the user's running dashboard.
  await writeFile(join(dir, 'start.mjs'), `import { Server } from 'node:http';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => console.log('TEST_PORT=' + this.address().port));
  return listen.apply(this, args);
};
await import('./server.mjs');
`);
  const child = spawn(process.execPath, ['start.mjs'], {
    cwd: dir, env: { ...process.env, PORT: '0', PATH: join(dir, 'bin') + delimiter + process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    child.on('error', reject);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/TEST_PORT=(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base + '/api/prs');
  assert.equal(response.status, 200);
  const prs = await response.json();
  assert.equal(prs.length, 3);
  assert.equal(prs.find(pr => pr.number === 2).source, 'review');
  assert.equal(prs.find(pr => pr.number === 2).lane, 'review');
  assert.equal(prs.find(pr => pr.number === 3).lane, 'draft');
  const queries = (await readFile(join(dir, 'queries.log'), 'utf8')).trim().split('\n');
  assert.equal(queries.length, 3);
  assert.ok(queries.every(query => query.includes('"DEMO" in:title') && query.includes('repo:demo/app')));
  assert.ok(queries.some(query => query.endsWith(' user-review-requested:@me')));
  const module = await fetch(base + '/ui-state.mjs');
  assert.equal(module.headers.get('content-type'), 'text/javascript');
  assert.equal(await module.text(), await readFile(new URL('ui-state.mjs', import.meta.url), 'utf8'));
  const privateFile = await fetch(base + '/config.json');
  assert.equal(privateFile.headers.get('content-type'), 'text/html');
});

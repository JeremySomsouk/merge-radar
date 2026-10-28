import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const fixturePr = (number, extra = {}) => ({
  number, title: `DEMO change ${number}`, url: `https://github.com/demo/app/pull/${number}`,
  state: 'OPEN', isDraft: false, updatedAt: '2026-10-28T00:00:00Z', mergeable: 'MERGEABLE',
  reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', repository: { nameWithOwner: 'demo/app' },
  author: { __typename: 'User' }, commits: { nodes: [] }, reviewThreads: { nodes: [] }, ...extra,
});

test('server syncs direct and repository-scoped requests with deduplication and safe assets', { timeout: 15000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'merge-radar-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of ['server.mjs', 'lib.mjs', 'reviews.mjs', 'notifications.mjs', 'index.html', 'ui-state.mjs', 'config.example.json']) {
    await cp(new URL(file, import.meta.url), join(dir, file));
  }
  await mkdir(join(dir, 'bin'));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ keyword: 'DEMO', extra: 'repo:demo/app', ignore: '' }));
  const requested = fixturePr(2);
  await writeFile(join(dir, 'fixtures.json'), JSON.stringify({
    'assignee:@me': [requested],
    'author:@me': [fixturePr(1)],
    'user-review-requested:@me': [requested, fixturePr(3, { isDraft: true })],
    repositoryPages: [
      [{ number: 2, title: 'DEMO change 2', created_at: new Date().toISOString(), user: { login: 'teammate' }, requested_reviewers: [{ login: 'octocat' }] }],
      [{ number: 4, title: 'Other service refactor', created_at: new Date().toISOString(), user: { login: 'teammate' }, requested_teams: [{ slug: 'platform' }] }],
    ],
    details: { 2: requested, 4: fixturePr(4, { title: 'Other service refactor' }) },
  }));
  await writeFile(join(dir, 'bin', 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'api') process.exit(2);
const fixtures = JSON.parse(fs.readFileSync('fixtures.json', 'utf8'));
if (args[1] === 'user') { console.log('octocat'); process.exit(0); }
if (args[1].startsWith('repos/')) {
  if (fs.existsSync('fail-list')) { console.error('fixture repository denied'); process.exit(7); }
  if (!args.includes('--paginate') || !args.includes('--slurp')) process.exit(8);
  fs.appendFileSync('listings.log', args[1] + '\\n');
  console.log(JSON.stringify(fixtures.repositoryPages)); process.exit(0);
}
if (args[1] !== 'graphql') process.exit(2);
const search = args.find(arg => arg.startsWith('q='));
if (search) {
  const query = search.slice(2);
  fs.appendFileSync('queries.log', query + '\\n');
  const nodes = fixtures[query.split(' ').at(-1)];
  if (!nodes) process.exit(3);
  if (fs.existsSync('wait-for-details')) {
    const deadline = Date.now() + 3000;
    while (!fs.existsSync('details-started')) {
      if (Date.now() > deadline) { console.error('Review details waited for searches'); process.exit(9); }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  console.log(JSON.stringify({ data: { search: { nodes } } }));
} else {
  fs.writeFileSync('details-started', '');
  const number = args.find(arg => arg.startsWith('number=')).slice(7);
  console.log(JSON.stringify({ data: { repository: { pullRequest: fixtures.details[number] } } }));
}
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
  await writeFile(join(dir, 'config.json'), JSON.stringify({
    keyword: 'DEMO', extra: 'repo:demo/app', ignore: '', reviewSource: 'repositories',
    reviewRepos: 'demo/app', reviewTeams: 'demo/platform',
  }));
  await writeFile(join(dir, 'wait-for-details'), '');
  const responses = await Promise.all([fetch(base + '/api/prs'), fetch(base + '/api/prs')]);
  const [scoped, concurrent] = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(scoped, concurrent);
  assert.deepEqual(scoped.filter(pr => pr.source === 'review').map(pr => pr.number).sort(), [2, 4]);
  assert.equal(scoped.find(pr => pr.number === 4).title, 'Other service refactor');
  assert.equal((await readFile(join(dir, 'listings.log'), 'utf8')).trim().split('\n').length, 1);
  assert.equal((await readFile(join(dir, 'queries.log'), 'utf8')).trim().split('\n').length, 5);
  await writeFile(join(dir, 'fail-list'), '');
  const failed = await fetch(base + '/api/prs');
  assert.equal(failed.status, 500);
  assert.match(await failed.text(), /fixture repository denied/);
  const module = await fetch(base + '/ui-state.mjs');
  assert.equal(module.headers.get('content-type'), 'text/javascript');
  assert.equal(await module.text(), await readFile(new URL('ui-state.mjs', import.meta.url), 'utf8'));
  const privateFile = await fetch(base + '/config.json');
  assert.equal(privateFile.headers.get('content-type'), 'text/html');
});

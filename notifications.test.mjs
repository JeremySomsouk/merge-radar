import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reviewSnapshot, newReviewUrls, checkReviewNotifications, notifyMac } from './notifications.mjs';

const config = { reviewSource: 'repositories', reviewRepos: 'demo/api', reviewTeams: 'demo/team', reviewMaxAgeDays: 60 };
const pr = (n, extra = {}) => ({ url: `https://github.com/demo/api/pull/${n}`, source: 'review', lane: 'review', ...extra });

test('first sync and scope changes are quiet; only new non-draft review requests count', () => {
  const first = reviewSnapshot([pr(1)], config);
  assert.equal(newReviewUrls(null, first).length, 0);
  const next = reviewSnapshot([pr(1), pr(2), pr(2), pr(3, { lane: 'draft' }), pr(4, { source: 'mine' })], config);
  assert.equal(newReviewUrls(first, next).length, 1);
  assert.equal(newReviewUrls(next, next).length, 0);
  assert.equal(newReviewUrls(first, reviewSnapshot([pr(2)], { ...config, reviewTeams: 'demo/other' })).length, 0);
  const empty = reviewSnapshot([], config);
  assert.equal(newReviewUrls(empty, first).length, 1);
});

test('notification state survives restart, retries failures, and stores no PR titles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-notifications-'));
  const file = pathToFileURL(join(dir, 'state.json'));
  const sent = [];
  const check = (prs, notify = async urls => sent.push(urls.length)) => checkReviewNotifications({ prs, config, file, notify });
  try {
    await check([pr(1)]);
    assert.deepEqual(sent, []);
    await assert.rejects(check([pr(1), pr(2)], async () => { throw new Error('Unavailable'); }));
    await check([pr(1), pr(2, { title: 'Private title' })]);
    await check([pr(1), pr(2)]);
    assert.deepEqual(sent, [1]);
    assert.equal((await readFile(file, 'utf8')).includes('Private title'), false);
    await writeFile(file, '{broken');
    await check([pr(1), pr(2), pr(3)]);
    assert.deepEqual(sent, [1]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('macOS notification opens a single PR directly and a batch in the dashboard', async () => {
  const calls = [];
  const run = async (command, args, options) => { calls.push(args); assert.equal(command, 'terminal-notifier'); assert.equal(options.timeout, 15000); };
  const dashboard = 'http://localhost:4747';
  await notifyMac(run, [pr(1).url], dashboard);
  assert.equal(calls[0].at(-1), pr(1).url);
  assert.equal(calls[0].at(-2), '-open');
  await notifyMac(run, [pr(1).url, pr(2).url], dashboard);
  assert.equal(calls[1].at(-1), dashboard);
  assert.match(calls[1][3], /^2 new pull requests need your review/);
  for (const url of ['file:///tmp/test', 'https://github.com.evil.test/a/b/pull/1', 'javascript:alert(1)']) {
    await notifyMac(run, [url], dashboard);
    assert.equal(calls.at(-1).at(-1), dashboard);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRepositoryReviews, hydrateReviews } from './reviews.mjs';

const now = Date.parse('2026-10-28T12:00:00Z');
const config = { reviewRepos: 'demo/app, demo/api', reviewTeams: 'demo/platform', reviewExcludePrefixes: 'chore(deps)', reviewMaxAgeDays: 60 };
const candidate = (number, extra = {}) => ({ number, title: 'Improve search', draft: false, created_at: '2026-10-27T12:00:00Z', user: { login: 'teammate' }, requested_reviewers: [], requested_teams: [], ...extra });

function mockListings(pages, calls = []) {
  return async (_cmd, args) => {
    calls.push(args);
    if (args[1] === 'user') return { stdout: 'octocat\n' };
    assert.ok(args.includes('--paginate'));
    assert.ok(args.includes('--slurp'));
    const repo = args[1].match(/^repos\/(.+)\/pulls\?/)[1];
    return { stdout: JSON.stringify(pages[repo] ?? [[]]) };
  };
}

test('repository sync finds direct and configured-team requests across pages', async () => {
  const calls = [];
  const run = mockListings({ 'demo/app': [
    [candidate(1, { requested_reviewers: [{ login: 'OctoCat' }] })],
    [candidate(2, { requested_teams: [{ slug: 'Platform' }] })],
  ], 'demo/api': [[candidate(3, { requested_reviewers: [{ login: 'other' }], requested_teams: [{ slug: 'other' }] })]] }, calls);
  assert.deepEqual(await findRepositoryReviews(run, config, now), [
    { owner: 'demo', repo: 'app', number: 1 }, { owner: 'demo', repo: 'app', number: 2 },
  ]);
  assert.equal(calls.length, 3);
});

test('repository sync matches prctrl own/draft/prefix/age exclusions', async () => {
  const own = { requested_reviewers: [{ login: 'octocat' }] };
  const run = mockListings({ 'demo/app': [[
    candidate(1, { ...own, user: { login: 'OCTOCAT' } }),
    candidate(2, { ...own, draft: true }),
    candidate(3, { ...own, title: 'chore(deps): update packages' }),
    candidate(4, { ...own, created_at: '2026-08-01T12:00:00Z' }),
    candidate(5, { ...own, created_at: null }),
    candidate(6, { ...own, created_at: new Date(now - 60 * 864e5).toISOString() }),
  ]] });
  assert.deepEqual(await findRepositoryReviews(run, config, now), [{ owner: 'demo', repo: 'app', number: 6 }]);
});

test('team matching is scoped to the repository owner', async () => {
  const run = mockListings({ 'other/app': [[candidate(1, { requested_teams: [{ slug: 'platform' }] })]] });
  assert.deepEqual(await findRepositoryReviews(run, { ...config, reviewRepos: 'other/app' }, now), []);
});

test('invalid scope is rejected before any GitHub request', async () => {
  const run = () => assert.fail('should not call GitHub');
  for (const reviewRepos of ['', 'app', 'demo/../app', 'demo/..', 'https://github.com/demo/app']) {
    await assert.rejects(findRepositoryReviews(run, { ...config, reviewRepos }, now), /owner\/repository/);
  }
  await assert.rejects(findRepositoryReviews(run, { ...config, reviewTeams: 'platform' }, now), /owner\/team/);
});

test('duplicate repositories are fetched once and failed pages are not silently dropped', async () => {
  const calls = [];
  await findRepositoryReviews(mockListings({}, calls), { ...config, reviewRepos: 'demo/app, DEMO/APP' }, now);
  assert.equal(calls.length, 2);
  await assert.rejects(findRepositoryReviews(async () => { throw new Error('permission denied'); }, config, now), /permission denied/);
});

test('hydration reuses known PRs and fetches missing ones outside dashboard search filters', async () => {
  const known = { url: 'https://github.com/demo/app/pull/1', state: 'OPEN', isDraft: false };
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(args);
    assert.equal(cmd, 'gh');
    assert.ok(args.includes('owner=demo'));
    assert.ok(args.includes('repo=app'));
    assert.ok(args.includes('number=2'));
    return { stdout: JSON.stringify({ data: { repository: { pullRequest: { url: 'https://github.com/demo/app/pull/2', state: 'OPEN', isDraft: false } } } }) };
  };
  const results = await hydrateReviews(run, [{ owner: 'demo', repo: 'app', number: 1 }, { owner: 'demo', repo: 'app', number: 2 }], [known]);
  assert.equal(results.length, 2);
  assert.equal(results[0], known);
  assert.equal(calls.length, 1);
});

test('hydration drops newly closed or draft PRs and reports inaccessible PRs', async () => {
  const targets = [{ owner: 'demo', repo: 'app', number: 1 }];
  for (const pr of [{ state: 'CLOSED', isDraft: false }, { state: 'OPEN', isDraft: true }]) {
    assert.deepEqual(await hydrateReviews(async () => ({ stdout: JSON.stringify({ data: { repository: { pullRequest: pr } } }) }), targets), []);
  }
  await assert.rejects(hydrateReviews(async () => ({ stdout: '{"data":{"repository":null}}' }), targets), /access/);
});

test('search loads small pages with cursors and preserves the 50 PR cap', async () => {
  const { searchPrs } = await import('./reviews.mjs');
  const calls = [];
  const run = async (_cmd, args) => {
    const size = Number(args.find(arg => arg.startsWith('size=')).slice(5));
    assert.ok(size <= 5);
    const cursor = args.find(arg => arg.startsWith('after='))?.slice(6);
    assert.equal(cursor, calls.length ? String(calls.length * 5) : undefined);
    calls.push(args);
    return { stdout: JSON.stringify({ data: { search: {
      nodes: Array.from({ length: size }, (_, i) => ({ number: (calls.length - 1) * 5 + i })),
      pageInfo: { hasNextPage: true, endCursor: String(calls.length * 5) },
    } } }) };
  };
  assert.equal((await searchPrs(run, 'is:pr')).length, 50);
  assert.equal(calls.length, 10);
});

test('search stops at the last page and rejects partial GraphQL responses', async () => {
  const { searchPrs } = await import('./reviews.mjs');
  const response = search => async () => ({ stdout: JSON.stringify({ data: { search } }) });
  assert.deepEqual(await searchPrs(response({ nodes: [{ number: 1 }], pageInfo: { hasNextPage: false } }), 'is:pr'), [{ number: 1 }]);
  await assert.rejects(searchPrs(async () => ({ stdout: JSON.stringify({ data: { search: { nodes: [] } }, errors: [{ message: 'Resource limits for this query exceeded.' }] }) }), 'is:pr'), /Resource limits/);
  await assert.rejects(searchPrs(response({ nodes: [], pageInfo: { hasNextPage: true, endCursor: null } }), 'is:pr'), /cursor/i);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, dedupe } from './lib.mjs';

const pr = (over = {}) => ({
  number: 1, title: 'Fix bug', url: 'https://github.com/o/r/pull/1', isDraft: false, updatedAt: '2026-10-28T00:00:00Z',
  mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', repository: { nameWithOwner: 'o/r' },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }] },
  reviewThreads: { nodes: [] },
  ...over,
});
const checks = (...nodes) => ({ nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }] });

test('clean PR is ready', () => assert.equal(classify(pr()).lane, 'ready'));

test('failing check, conflict or threads need me', () => {
  assert.equal(classify(pr({ commits: checks({ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'u' }) })).lane, 'me');
  assert.equal(classify(pr({ mergeable: 'CONFLICTING' })).lane, 'me');
  assert.equal(classify(pr({ reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ url: 't' }] } }] } })).blockers[0].url, 't');
});

test('running CI or missing review waits on others', () => {
  assert.equal(classify(pr({ commits: checks({ __typename: 'StatusContext', context: 'ci', state: 'PENDING', targetUrl: 'u' }) })).lane, 'others');
  assert.equal(classify(pr({ reviewDecision: 'REVIEW_REQUIRED' })).lane, 'others');
});

test('needs me wins over waiting and hides waiting blockers', () => {
  const c = classify(pr({ mergeable: 'CONFLICTING', reviewDecision: 'REVIEW_REQUIRED' }));
  assert.equal(c.lane, 'me');
  assert.deepEqual(c.blockers.map((b) => b.label), ['Merge conflict']);
});

test('drafts get their own lane', () => {
  assert.equal(classify(pr({ isDraft: true, mergeable: 'CONFLICTING' })).lane, 'draft');
});

test('no rollup does not crash', () => {
  assert.equal(classify(pr({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })).lane, 'ready');
});

test('ignored checks do not block', () => {
  assert.equal(classify(pr({ commits: checks({ __typename: 'StatusContext', context: 'ci/optional-check', state: 'FAILURE', targetUrl: 'u' }) }), ['optional-check']).lane, 'ready');
});

test('bot-authored PRs are bot, others are mine', () => {
  assert.equal(classify(pr({ author: { __typename: 'Bot' } })).source, 'bot');
  assert.equal(classify(pr({ author: { __typename: 'User' } })).source, 'mine');
});

test('dedupe by url', () => assert.equal(dedupe([pr(), pr()]).length, 1));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMorning, readSnoozes, reviewRequestText } from './ui-state.mjs';

test('snooze ends at 9 a.m. on the next local calendar day', () => {
  for (const hour of [0, 8, 12, 23]) {
    const now = new Date(2026, 9, 28, hour, 45);
    assert.equal(nextMorning(now), new Date(2026, 9, 29, 9).getTime());
  }
});

test('snooze handles month, year and daylight-saving boundaries', () => {
  for (const [year, month, day] of [[2026, 11, 31], [2026, 9, 24], [2026, 2, 28]]) {
    const now = new Date(year, month, day, 23);
    const expected = new Date(year, month, day + 1, 9);
    assert.equal(nextMorning(now), expected.getTime());
  }
});

test('invalid or expired browser storage cannot hide PRs', () => {
  for (const raw of [null, '', '{', 'null', '[]', '42', '"oops"']) {
    assert.deepEqual(readSnoozes(raw, 100), {});
  }
  assert.deepEqual(readSnoozes(JSON.stringify({ expired: 99, due: 100, string: '200', invalid: null, active: 200 }), 100), { active: 200 });
});

test('copyable review request includes the full repository, title and URL', () => {
  assert.equal(reviewRequestText({ repo: 'demo/api', number: 7, title: 'Fix search', url: 'https://github.com/demo/api/pull/7' }),
    'Could you review demo/api#7: Fix search?\nhttps://github.com/demo/api/pull/7');
});

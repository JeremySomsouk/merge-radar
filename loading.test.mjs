import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { readSnoozes } from './ui-state.mjs';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/m, '');
const settle = () => new Promise(resolve => setImmediate(resolve));

function dashboard() {
  const elements = new Map();
  const requests = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', innerHTML: '', addEventListener() {}, setAttribute(key, value) { this[key] = value; } });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element, querySelectorAll: () => [] },
    window: { addEventListener() {} }, localStorage: { getItem: () => null },
    readSnoozes, setInterval() {}, clearInterval() {}, clearTimeout() {},
    fetch: url => new Promise(resolve => requests.push({ url, resolve })),
  };
  runInNewContext(script, context);
  return { context, requests, element };
}
const respond = (request, data, ok = true) => request.resolve({ ok, json: async () => data, text: async () => data });

test('initial settings and PRs start together, loader persists until both finish and stays hidden on refresh', async () => {
  const { context, requests, element } = dashboard();
  assert.deepEqual(requests.map(request => request.url), ['/api/prs', '/api/config']);
  assert.equal(element('loading').hidden, false);
  assert.equal(element('refresh').disabled, true);
  respond(requests[0], []);
  await settle();
  assert.equal(element('loading').hidden, false);
  respond(requests[1], { minutes: 3, first: 'mine' });
  await settle();
  assert.equal(element('loading').hidden, true);
  assert.equal(element('groups')['aria-busy'], 'false');
  assert.match(element('groups').innerHTML, /No PRs are waiting/);
  const refresh = context.refresh();
  assert.equal(element('loading').hidden, true);
  respond(requests[2], 'GitHub unavailable', false);
  await refresh;
  assert.equal(element('error').textContent, 'GitHub unavailable');
  assert.match(element('groups').innerHTML, /No PRs are waiting/);
});

test('initial config failure ends loading and refresh retries settings and PRs', async () => {
  const { context, requests, element } = dashboard();
  respond(requests[1], 'Cannot load settings', false);
  respond(requests[0], []);
  await settle();
  assert.equal(element('loading').hidden, true);
  assert.equal(element('refresh').disabled, false);
  assert.equal(element('status').textContent, 'Failed');
  const retry = context.refresh();
  assert.equal(element('loading').hidden, false);
  assert.deepEqual(requests.slice(2).map(request => request.url), ['/api/prs', '/api/config']);
  respond(requests[2], []);
  respond(requests[3], { minutes: 3 });
  await retry;
  assert.equal(element('loading').hidden, true);
  assert.equal(element('error').textContent, '');
});

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const PENDING = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED']);
export const PR_FIELDS = `
  ... on PullRequest {
    number title url isDraft updatedAt mergeable reviewDecision mergeStateStatus
    repository { nameWithOwner }
    author { __typename }
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
      __typename
      ... on CheckRun { name status conclusion detailsUrl }
      ... on StatusContext { context state targetUrl }
    } } } } } }
    reviewThreads(first: 100) { nodes { isResolved comments(first: 1) { nodes { url } } } }
  }`;

function checkState(c) {
  if (c.__typename === 'StatusContext') return { name: c.context, state: c.state, url: c.targetUrl };
  return { name: c.name, state: c.status === 'COMPLETED' ? c.conclusion : c.status, url: c.detailsUrl };
}

export function classify(pr, ignoredChecks = []) {
  const checks = (pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [])
    .map(checkState)
    .filter((c) => !ignoredChecks.some((part) => c.name.includes(part)));
  const failing = checks.filter((c) => FAILED.has(c.state));
  const running = checks.filter((c) => PENDING.has(c.state));
  const threads = pr.reviewThreads.nodes.filter((t) => !t.isResolved);

  const mine = [];
  const others = [];
  if (pr.mergeable === 'CONFLICTING') mine.push({ label: 'Merge conflict', url: `${pr.url}/conflicts` });
  for (const c of failing) mine.push({ label: `CI failed: ${c.name}`, url: c.url ?? `${pr.url}/checks` });
  if (threads.length) mine.push({ label: `${threads.length} unresolved thread(s)`, url: threads[0].comments.nodes[0]?.url ?? `${pr.url}/files` });
  if (pr.reviewDecision === 'CHANGES_REQUESTED') mine.push({ label: 'Changes requested', url: pr.url });

  if (running.length) others.push({ label: `CI running (${running.length})`, url: `${pr.url}/checks` });
  if (pr.reviewDecision === 'REVIEW_REQUIRED') others.push({ label: 'Review required', url: pr.url });
  if (pr.mergeable === 'UNKNOWN') others.push({ label: 'Mergeability computing', url: pr.url });
  if (!mine.length && !others.length && pr.mergeStateStatus === 'BLOCKED') others.push({ label: 'Blocked by branch protection', url: pr.url });

  const lane = pr.isDraft ? 'draft' : mine.length ? 'me' : others.length ? 'others' : 'ready';
  const source = pr.author?.__typename === 'Bot' ? 'bot' : 'mine';
  return { number: pr.number, title: pr.title, url: pr.url, repo: pr.repository.nameWithOwner, updatedAt: pr.updatedAt, lane, source, blockers: mine.length ? mine : others };
}

export function dedupe(prs) {
  return [...new Map(prs.map((p) => [p.url, p])).values()];
}

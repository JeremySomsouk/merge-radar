import { PR_FIELDS } from './lib.mjs';

const OPTIONS = { maxBuffer: 20e6, timeout: 60000 };
const SEARCH_QUERY = `query($q: String!, $size: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $size, after: $after) {
    nodes { ${PR_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function searchPrs(run, q) {
  const prs = [];
  let after;
  while (prs.length < 50) {
    const args = ['api', 'graphql', '-f', `query=${SEARCH_QUERY}`, '-f', `q=${q}`, '-F', `size=${Math.min(5, 50 - prs.length)}`];
    if (after) args.push('-f', `after=${after}`);
    const { stdout } = await run('gh', args, OPTIONS);
    const result = JSON.parse(stdout);
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
    const page = result.data?.search;
    if (!Array.isArray(page?.nodes) || !page.pageInfo) throw new Error('GitHub returned an invalid pull request search.');
    prs.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    if (!page.pageInfo.endCursor || page.pageInfo.endCursor === after) throw new Error('GitHub returned an invalid search cursor.');
    after = page.pageInfo.endCursor;
  }
  return prs;
}

const DETAIL_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { ${PR_FIELDS} } }
}`;

function scopeList(value, label) {
  const entries = [...new Set(value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/.test(entry) || ['.', '..'].includes(entry.split('/')[1])) {
      throw new Error(`${label} must use ${label === 'Review repositories' ? 'owner/repository' : 'owner/team'} format, separated by commas.`);
    }
  }
  return entries;
}

async function mapLimited(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) results[index] = await fn(items[index]);
  }));
  return results;
}

export async function findRepositoryReviews(run, config, now = Date.now()) {
  const repos = scopeList(config.reviewRepos, 'Review repositories');
  if (!repos.length) throw new Error('Add at least one review repository in owner/repository format in Settings.');
  const teams = new Set(scopeList(config.reviewTeams, 'Review teams'));
  const prefixes = config.reviewExcludePrefixes.split(',').map((part) => part.trim()).filter(Boolean);
  const maxAge = config.reviewMaxAgeDays;
  if (!Number.isInteger(maxAge) || maxAge < 0) throw new Error('Maximum review age must be a whole number of days, zero or greater.');
  const [user, listings] = await Promise.all([
    run('gh', ['api', 'user', '--jq', '.login'], OPTIONS),
    mapLimited(repos, async (repo) => {
      const { stdout } = await run('gh', ['api', `repos/${repo}/pulls?state=open&per_page=100`, '--paginate', '--slurp'], OPTIONS);
      const pages = JSON.parse(stdout);
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error('GitHub returned an invalid pull request list.');
      return { repo, prs: pages.flat() };
    }),
  ]);
  const username = user.stdout.trim().toLowerCase();
  if (!username) throw new Error('Could not determine the GitHub CLI account. Run gh auth status.');
  return listings.flatMap(({ repo: fullRepo, prs }) => {
    const [owner, repo] = fullRepo.split('/');
    return prs.filter((pr) => {
      if (pr.draft || pr.user?.login?.toLowerCase() === username) return false;
      if (prefixes.some((prefix) => (pr.title ?? '').startsWith(prefix))) return false;
      const created = Date.parse(pr.created_at);
      if (!Number.isFinite(created) || Math.floor((now - created) / 864e5) > maxAge) return false;
      const direct = (pr.requested_reviewers ?? []).some((reviewer) => reviewer.login.toLowerCase() === username);
      const team = (pr.requested_teams ?? []).some((team) => teams.has(`${owner}/${team.slug.toLowerCase()}`));
      return direct || team;
    }).map((pr) => ({ owner, repo, number: pr.number }));
  });
}

export async function hydrateReviews(run, targets, knownPrs = []) {
  const known = new Map(knownPrs.map((pr) => [pr.url.toLowerCase(), pr]));
  const prs = await mapLimited(targets, async ({ owner, repo, number }) => {
    const existing = known.get(`https://github.com/${owner}/${repo}/pull/${number}`.toLowerCase());
    if (existing) return existing;
    const { stdout } = await run('gh', ['api', 'graphql', '-f', `query=${DETAIL_QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${number}`], OPTIONS);
    const result = JSON.parse(stdout);
    const pr = result.data?.repository?.pullRequest;
    if (result.errors?.length || !pr) throw new Error('Could not load a requested review. Check that your GitHub CLI account has access to every review repository.');
    return pr;
  });
  return prs.filter((pr) => pr.state === 'OPEN' && !pr.isDraft);
}

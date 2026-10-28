export function nextMorning(now = new Date()) {
  const wake = new Date(now);
  wake.setDate(wake.getDate() + 1);
  wake.setHours(9, 0, 0, 0);
  return wake.getTime();
}

export function readSnoozes(raw, now = Date.now()) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([, until]) => Number.isFinite(until) && until > now));
  } catch {
    return {};
  }
}

export function reviewRequestText(pr) {
  return `Could you review ${pr.repo}#${pr.number}: ${pr.title}?\n${pr.url}`;
}

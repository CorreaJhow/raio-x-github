#!/usr/bin/env node
// Steps 4 and 5: crosses collect.json + history.json, scores each axis and proposes the action plan.
// Usage: node audit.mjs [folder=xray]  -> writes audit.json, plan.json and REPORT.md (skeleton)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OLD_STUDY_YEARS = 2;
const YEAR_MS = 365 * 24 * 3600 * 1000;
const round = (n) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;

const repoQuality = (r, now) =>
  (r.description ? 0.3 : 0) + (r.readmeBytes > 300 ? 0.3 : 0) + (r.topics.length ? 0.2 : 0) +
  (r.license ? 0.1 : 0) + (now - Date.parse(r.lastPush) < YEAR_MS ? 0.1 : 0);

export function audit(collected, history = { repos: {}, privateItems: [] }, now = Date.now()) {
  const { profile } = collected;
  const findings = [];
  const plan = [];
  const find = (axis, severity, repo, text) => findings.push({ axis, severity, repo, text });
  const propose = (action) => plan.push({ id: plan.length + 1, ...action });
  const login = profile.login.toLowerCase();
  const pinned = new Set(collected.pinned.map((f) => f.split('/')[1]?.toLowerCase()));
  const publicRepos = collected.repos.filter((r) => r.isPublic);
  const showcase = publicRepos.filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== login);
  const suggestedPins = showcase
    .map((r) => ({ name: r.name, points: repoQuality(r, now) * 10 + Math.min(r.stars, 20) / 4 }))
    .sort((a, b) => b.points - a.points).slice(0, 6).map((r) => r.name);
  // What is (or should be) pinned is not an old study repo.
  const goodShowcase = new Set([...pinned, ...suggestedPins.map((n) => n.toLowerCase())]);

  // Profile
  if (!profile.bio.trim()) { find('profile', 'high', null, 'Empty bio: it is the first thing a recruiter reads.'); propose({ type: 'profile', field: 'bio', value: '', previous: '', pending: 'write the bio with the dev (up to 160 characters)', reason: 'empty bio' }); }
  if (!profile.name.trim()) find('profile', 'medium', null, 'Empty display name.');
  if (!profile.blog) find('profile', 'low', null, 'No website/portfolio on the profile.');
  if (!profile.socials.length) find('profile', 'low', null, 'No LinkedIn/social links on the profile.');
  if (!profile.profileReadme) find('profile', 'medium', null, `No profile README (public repo ${profile.login}/${profile.login}).`);
  if (collected.pinned.length < 4) find('showcase', 'medium', null, `Only ${collected.pinned.length} pinned repo(s); the profile allows 6.`);

  const privateItem = (name) => history.privateItems.find((p) => name.toLowerCase().includes(p));

  for (const r of publicRepos) {
    const h = history.repos[r.name] ?? {};
    const age = (now - Date.parse(r.lastPush)) / YEAR_MS;

    // Security
    const priv = privateItem(r.name) ?? h.privateItems?.[0]?.item;
    if (priv) {
      const where = h.privateItems?.length ? ` (e.g. ${h.privateItems.slice(0, 3).map((i) => i.path).join(', ')})` : '';
      find('security', 'high', r.name, `Item from the "must not be public" list (${priv}) in a public repo${where}.`);
      if (!r.fork) propose({ type: 'private', repo: r.name, reason: `contains "${priv}"` });
    }
    for (const s of dedupe(h.secrets ?? [])) {
      const firebase = s.rule === 'google-api' && /firebase/i.test(s.file);
      const sev = s.certainty === 'local' ? 'low' : firebase || s.certainty === 'suspected' ? 'medium' : 'high';
      const extra = s.certainty === 'local' ? ' Local database (localhost): low risk, but change the password if it is reused elsewhere and use user-secrets/environment variables.' : firebase ? ' A Firebase web key is public by design: check the database rules and the domain restriction.' : ' Revoke/rotate the key first: rewriting history does not undo the leak (forks and caches have already seen it).';
      find('security', sev, r.name, `Possible secret (${s.rule}, ${s.certainty}) in ${s.file} at commit ${s.commit}: ${s.snippet}.${extra}`);
    }
    for (const f of h.sensitiveFiles ?? []) find('security', 'high', r.name, `Sensitive file in history: ${f}.`);
    if (h.coauthors?.length) {
      const ex = h.coauthors[0].reasons[0];
      find('security', 'medium', r.name, `${h.coauthors.length} commit(s) with an unwanted co-author/signature on branches (e.g. ${ex}).`);
      propose({ type: 'clean-coauthor', repo: r.name, reason: `${h.coauthors.length} commit(s) with ${ex}` });
    }
    if (h.coauthorsPrOnly?.length) {
      find('security', 'medium', r.name, `${h.coauthorsPrOnly.length} commit(s) with an unwanted co-author only in PR refs (${h.pullRefs} refs/pull). Rewriting history does not clean closed PRs: only GitHub support or making the repo private does.`);
    }
    if (h.error) find('security', 'medium', r.name, `Could not scan the history: ${h.error}`);
    if (r.fork) {
      find('security', 'low', r.name, `Public fork${r.archived ? ' (already archived)' : ''} of ${r.forkOf ?? '?'}: a public fork can't be made private; the options are archive or delete (only the dev deletes, by hand).`);
      if (!r.archived) propose({ type: 'archive', repo: r.name, reason: 'a public fork cannot be made private' });
      continue;
    }
    if (r.name.toLowerCase() === login || r.archived) continue;

    // Quality
    if (age > OLD_STUDY_YEARS && !goodShowcase.has(r.name.toLowerCase()) && !priv) {
      find('quality', 'medium', r.name, `No push in ${age.toFixed(1)} years and outside the showcase: old public study repo? Candidate for private.`);
      propose({ type: 'private', repo: r.name, reason: `idle for ${age.toFixed(1)} years` });
    }
    if (!r.description) { find('quality', 'medium', r.name, 'No description.'); propose({ type: 'description', repo: r.name, value: '', previous: '', pending: 'write a one-sentence description', reason: 'no description' }); }
    if (!r.topics.length) { find('quality', 'low', r.name, 'No topics (hurts discoverability).'); propose({ type: 'topics', repo: r.name, value: [], pending: 'pick 3-6 topics', reason: 'no topics' }); }
    if (r.readmeBytes < 300) find('quality', 'medium', r.name, r.readmeBytes ? 'README too short (under 300 bytes).' : 'No README.');
  }

  // Scores per axis
  const profileScore = (profile.bio.trim() ? 3 : 0) + (profile.profileReadme ? 3 : 0) + (profile.name.trim() ? 1 : 0) +
    (profile.blog ? 1 : 0) + (profile.socials.length ? 1 : 0) + (profile.location || profile.company ? 1 : 0);
  const byName = new Map(collected.repos.map((r) => [r.name.toLowerCase(), r]));
  const pins = [...pinned].map((n) => byName.get(n)).filter(Boolean);
  const showcaseScore = (10 * pins.reduce((s, r) => s + (r.isPublic ? repoQuality(r, now) : 0), 0)) / 6;
  const qualityScore = showcase.length ? (10 * showcase.reduce((s, r) => s + repoQuality(r, now), 0)) / showcase.length : 0;
  const weight = { high: 3, medium: 1, low: 0.5 };
  const securityScore = 10 - findings.filter((a) => a.axis === 'security').reduce((s, a) => s + weight[a.severity], 0);
  const scores = {
    profile: round(profileScore), showcase: round(showcaseScore), quality: round(qualityScore), security: round(securityScore),
    alignment: null, // Claude fills this from the interview + trends (step 3)
  };

  return { scores, findings, plan, suggestedPins };
}

function dedupe(secrets) {
  const seen = new Set();
  return secrets.filter((s) => { const k = `${s.rule}|${s.file}|${s.snippet}`; return !seen.has(k) && seen.add(k); });
}

export function report(collected, a) {
  const values = Object.values(a.scores).filter((n) => n !== null);
  const overall = round(values.reduce((s, n) => s + n, 0) / values.length);
  const order = { high: 0, medium: 1, low: 2 };
  const rows = [...a.findings].sort((x, y) => order[x.severity] - order[y.severity])
    .map((x) => `| ${x.severity} | ${x.axis} | ${x.repo ?? 'profile'} | ${x.text.replace(/\|/g, '\\|')} |`);
  return `# GitHub X-ray — ${collected.profile.login}

Collected on ${collected.collectedAt.slice(0, 10)} · ${collected.repos.length} repos (${collected.repos.filter((r) => r.isPublic).length} public) · ${collected.contributionsLastYear} contributions in the last year

## Score: ${overall}/10 (without the alignment axis)

| Axis | Score |
|---|---|
| Profile (bio, README, links) | ${a.scores.profile} |
| Showcase (pinned) | ${a.scores.showcase} |
| Public repo quality | ${a.scores.quality} |
| Security | ${a.scores.security} |
| Alignment with the goal | <!-- fill in: score 0-10 + 1 sentence, from profile.md and the trends --> |

## Findings (${a.findings.length})

| Severity | Axis | Where | What |
|---|---|---|---|
${rows.join('\n') || '| — | — | — | nothing found |'}

## Suggested pins (the API can't pin: Profile > Customize your pins)
${a.suggestedPins.map((n, i) => `${i + 1}. ${n}`).join('\n')}

## Role trends
<!-- fill in: what recruiters and the community expect for the role/level + 2-3 reference profiles (with links) -->

## What to change and why
<!-- fill in: the 3-5 highest-impact changes, in order -->

## Next repos plan
| Phase | Timeline | Repo | Why |
|---|---|---|---|
<!-- fill in: 3-5 rows by role/level/stack -->

## How to apply
\`bash xray/apply.sh\` shows what it would do (dry-run). \`bash xray/apply.sh --apply\` runs it. Each step prints how to undo it.
`;
}

if (process.argv[1]?.endsWith('audit.mjs')) {
  const folder = process.argv[2] || 'xray';
  const collected = JSON.parse(readFileSync(join(folder, 'collect.json'), 'utf8'));
  const hFile = join(folder, 'history.json');
  const history = existsSync(hFile) ? JSON.parse(readFileSync(hFile, 'utf8')) : (console.log('warning: no history.json, history security was not checked'), undefined);
  const a = audit(collected, history);
  writeFileSync(join(folder, 'audit.json'), JSON.stringify(a, null, 2));
  writeFileSync(join(folder, 'plan.json'), JSON.stringify({ login: collected.profile.login, actions: a.plan }, null, 2));
  writeFileSync(join(folder, 'REPORT.md'), report(collected, a));
  console.log(`ok  scores ${JSON.stringify(a.scores)} · ${a.findings.length} findings · ${a.plan.length} proposed actions`);
}

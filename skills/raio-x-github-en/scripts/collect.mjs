#!/usr/bin/env node
// Step 2: collects profile, repos, pinned items and contributions via `gh` (read-only).
// Usage: node collect.mjs [output-folder=xray]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const graphql = (query, vars = {}) =>
  gh(['api', 'graphql', '-f', `query=${query}`, ...Object.entries(vars).flatMap(([k, v]) => ['-F', `${k}=${v}`])]).data;

const REPO_FIELDS = `
  name nameWithOwner visibility isFork isArchived isPrivate description homepageUrl
  pushedAt createdAt stargazerCount forkCount diskUsage
  primaryLanguage { name }
  licenseInfo { spdxId }
  parent { nameWithOwner }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  readme1: object(expression: "HEAD:README.md") { ... on Blob { byteSize } }
  readme2: object(expression: "HEAD:readme.md") { ... on Blob { byteSize } }
  readme3: object(expression: "HEAD:Readme.md") { ... on Blob { byteSize } }`;

export function collect() {
  const user = gh(['api', 'user']);
  let social = [];
  try { social = gh(['api', 'user/social_accounts']); } catch { /* account with no social links */ }

  const repos = [];
  let cursor = null;
  do {
    const d = graphql(`query($cursor: String) { viewer { repositories(first: 100, after: $cursor, ownerAffiliations: OWNER) {
      pageInfo { hasNextPage endCursor } nodes { ${REPO_FIELDS} } } } }`, cursor ? { cursor } : {});
    const pg = d.viewer.repositories;
    for (const r of pg.nodes) {
      const readme = r.readme1 || r.readme2 || r.readme3;
      repos.push({
        name: r.name, full: r.nameWithOwner, isPublic: !r.isPrivate, fork: r.isFork, forkOf: r.parent?.nameWithOwner ?? null,
        archived: r.isArchived, description: r.description ?? '', homepage: r.homepageUrl ?? '',
        topics: r.repositoryTopics.nodes.map((n) => n.topic.name), language: r.primaryLanguage?.name ?? null,
        license: r.licenseInfo?.spdxId ?? null, readmeBytes: readme?.byteSize ?? 0, lastPush: r.pushedAt,
        created: r.createdAt, stars: r.stargazerCount, forks: r.forkCount, sizeKb: r.diskUsage,
      });
    }
    cursor = pg.pageInfo.hasNextPage ? pg.pageInfo.endCursor : null;
  } while (cursor);

  const v = graphql(`{ viewer {
    pinnedItems(first: 6) { nodes { ... on Repository { nameWithOwner } ... on Gist { name } } }
    contributionsCollection { contributionCalendar { totalContributions } totalCommitContributions totalPullRequestContributions }
  } }`).viewer;

  return {
    collectedAt: new Date().toISOString(),
    profile: {
      login: user.login, name: user.name ?? '', bio: user.bio ?? '', blog: user.blog ?? '', company: user.company ?? '',
      location: user.location ?? '', email: user.email ?? '', hireable: user.hireable, avatar: user.avatar_url,
      followers: user.followers, createdAt: user.created_at, socials: social.map((s) => s.url),
      profileReadme: repos.some((r) => r.name.toLowerCase() === user.login.toLowerCase() && r.isPublic),
    },
    pinned: v.pinnedItems.nodes.map((n) => n.nameWithOwner ?? `gist:${n.name}`),
    contributionsLastYear: v.contributionsCollection.contributionCalendar.totalContributions,
    commitsLastYear: v.contributionsCollection.totalCommitContributions,
    prsLastYear: v.contributionsCollection.totalPullRequestContributions,
    repos,
  };
}

if (process.argv[1]?.endsWith('collect.mjs')) {
  const out = process.argv[2] || 'xray';
  mkdirSync(out, { recursive: true });
  const c = collect();
  writeFileSync(join(out, 'collect.json'), JSON.stringify(c, null, 2));
  const pub = c.repos.filter((r) => r.isPublic).length;
  console.log(`ok  ${join(out, 'collect.json')}: ${c.repos.length} repos (${pub} public), ${c.pinned.length} pinned`);
}

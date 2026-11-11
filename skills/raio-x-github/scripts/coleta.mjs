#!/usr/bin/env node
// Passo 2: coleta perfil, repos, fixados e contribuições via `gh` (só leitura).
// Uso: node coleta.mjs [pasta-saida=raio-x]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const graphql = (query, vars = {}) =>
  gh(['api', 'graphql', '-f', `query=${query}`, ...Object.entries(vars).flatMap(([k, v]) => ['-F', `${k}=${v}`])]).data;

const CAMPOS_REPO = `
  name nameWithOwner visibility isFork isArchived isPrivate description homepageUrl
  pushedAt createdAt stargazerCount forkCount diskUsage
  primaryLanguage { name }
  licenseInfo { spdxId }
  parent { nameWithOwner }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  readme1: object(expression: "HEAD:README.md") { ... on Blob { byteSize } }
  readme2: object(expression: "HEAD:readme.md") { ... on Blob { byteSize } }
  readme3: object(expression: "HEAD:Readme.md") { ... on Blob { byteSize } }`;

export function coletar() {
  const user = gh(['api', 'user']);
  let social = [];
  try { social = gh(['api', 'user/social_accounts']); } catch { /* conta sem redes */ }

  const repos = [];
  let cursor = null;
  do {
    const d = graphql(`query($cursor: String) { viewer { repositories(first: 100, after: $cursor, ownerAffiliations: OWNER) {
      pageInfo { hasNextPage endCursor } nodes { ${CAMPOS_REPO} } } } }`, cursor ? { cursor } : {});
    const pg = d.viewer.repositories;
    for (const r of pg.nodes) {
      const readme = r.readme1 || r.readme2 || r.readme3;
      repos.push({
        nome: r.name, completo: r.nameWithOwner, publico: !r.isPrivate, fork: r.isFork, forkDe: r.parent?.nameWithOwner ?? null,
        arquivado: r.isArchived, descricao: r.description ?? '', homepage: r.homepageUrl ?? '',
        topics: r.repositoryTopics.nodes.map((n) => n.topic.name), linguagem: r.primaryLanguage?.name ?? null,
        licenca: r.licenseInfo?.spdxId ?? null, readmeBytes: readme?.byteSize ?? 0, ultimoPush: r.pushedAt,
        criado: r.createdAt, estrelas: r.stargazerCount, forks: r.forkCount, tamanhoKb: r.diskUsage,
      });
    }
    cursor = pg.pageInfo.hasNextPage ? pg.pageInfo.endCursor : null;
  } while (cursor);

  const v = graphql(`{ viewer {
    pinnedItems(first: 6) { nodes { ... on Repository { nameWithOwner } ... on Gist { name } } }
    contributionsCollection { contributionCalendar { totalContributions } totalCommitContributions totalPullRequestContributions }
  } }`).viewer;

  return {
    coletadoEm: new Date().toISOString(),
    perfil: {
      login: user.login, nome: user.name ?? '', bio: user.bio ?? '', blog: user.blog ?? '', empresa: user.company ?? '',
      local: user.location ?? '', email: user.email ?? '', contratavel: user.hireable, avatar: user.avatar_url,
      seguidores: user.followers, criadoEm: user.created_at, redes: social.map((s) => s.url),
      readmePerfil: repos.some((r) => r.nome.toLowerCase() === user.login.toLowerCase() && r.publico),
    },
    fixados: v.pinnedItems.nodes.map((n) => n.nameWithOwner ?? `gist:${n.name}`),
    contribuicoesUltimoAno: v.contributionsCollection.contributionCalendar.totalContributions,
    commitsUltimoAno: v.contributionsCollection.totalCommitContributions,
    prsUltimoAno: v.contributionsCollection.totalPullRequestContributions,
    repos,
  };
}

if (process.argv[1]?.endsWith('coleta.mjs')) {
  const saida = process.argv[2] || 'raio-x';
  mkdirSync(saida, { recursive: true });
  const c = coletar();
  writeFileSync(join(saida, 'coleta.json'), JSON.stringify(c, null, 2));
  const pub = c.repos.filter((r) => r.publico).length;
  console.log(`ok  ${join(saida, 'coleta.json')}: ${c.repos.length} repos (${pub} públicos), ${c.fixados.length} fixados`);
}

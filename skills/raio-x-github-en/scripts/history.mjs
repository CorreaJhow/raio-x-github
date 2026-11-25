#!/usr/bin/env node
// Step 4 (the part that needs history): mirror-clones each public repo (includes refs/pull)
// and looks for secrets, sensitive files, items from the "must not be public" list and unwanted co-authors.
// Usage: node history.mjs [folder=xray]   (reads folder/collect.json and folder/private.txt, writes folder/history.json)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_RULES = [
  ['private-key', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['aws', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['google-api', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['stripe', /\b[sr]k_live_[A-Za-z0-9]{20,}\b/],
  ['anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['openai', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/],
  ['connection-string', /(Password|Pwd)=[^;"'\s]{6,}/i],
  ['generic', /\b(api[_-]?key|secret|token|senha|password|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i],
];
// Example values don't count as secrets.
const EXAMPLE = /(example|exemplo|sample|your[_-]|seu[_-]|xxx|\*\*\*|changeme|placeholder|<|\$\{|\{\{|process\.env|configuration\[)/i;
const SENSITIVE_FILE = /(^|\/)(\.env(\.[\w.-]+)?|id_rsa|id_ed25519|[^/]+\.(pem|pfx|p12|key|keystore|jks)|credentials\.json|service-account[^/]*\.json|secrets?\.(json|ya?ml))$/i;
const ENV_OK = /\.env\.(example|sample|template|exemplo)$/i;
const VENDOR = /(^|\/)(node_modules|vendor|bower_components|packages|dist)\//; // third-party code: not the dev's secret
// github-actions and dependabot are legitimate automation; the target is an AI agent signing commits.
const BOT = /(anthropic|claude|copilot|cursor|openai|codex|devin)/i;

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
export const mask = (s) => `${s.slice(0, 4)}…(${s.length} chars)`;

export function scanPatch(text) {
  const findings = [];
  let commit = '', file = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('commit ')) { commit = line.slice(7, 19); continue; }
    if (line.startsWith('+++ ')) { file = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (!line.startsWith('+') || line.length > 500 || VENDOR.test(file)) continue; // minified line: skip
    for (const [rule, re] of SECRET_RULES) {
      const m = line.match(re);
      if (!m) continue;
      const value = m[2] ?? m[0];
      if (EXAMPLE.test(value) || EXAMPLE.test(line)) continue;
      findings.push({ rule, commit, file, snippet: mask(value), certainty: /localhost|127\.0\.0\.1|\(localdb\)/i.test(line) ? 'local' : rule === 'generic' || rule === 'connection-string' ? 'suspected' : 'high' });
      break;
    }
  }
  return findings;
}

export function scanCommits(text) {
  // record: hash \x1f author \x1f email \x1f message \x1e
  const out = [];
  for (const rec of text.split('\x1e')) {
    const [hash, author, email, msg = ''] = rec.replace(/^\s+/, '').split('\x1f');
    if (!hash) continue;
    const reasons = [];
    for (const m of msg.matchAll(/^Co-authored-by:\s*(.+)$/gim)) reasons.push(`co-author: ${m[1].trim()}`);
    if (/Generated with \[?Claude Code/i.test(msg)) reasons.push('footer "Generated with Claude Code"');
    if (BOT.test(`${author} ${email}`)) reasons.push(`bot author: ${author} <${email}>`);
    if (reasons.length) out.push({ commit: hash.slice(0, 12), reasons });
  }
  return out;
}

export function suspiciousFiles(paths, privateItems) {
  const sensitive = [], priv = [];
  for (const c of paths) {
    if (SENSITIVE_FILE.test(c) && !ENV_OK.test(c)) sensitive.push(c);
    const p = privateItems.find((x) => c.toLowerCase().includes(x));
    if (p) priv.push({ path: c, item: p });
  }
  return { sensitive, priv };
}

export const readPrivate = (file) => existsSync(file)
  ? readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'))
  : [];

const FORMAT = '--format=%H%x1f%an%x1f%ae%x1f%B%x1e';

function analyze(dir, privateItems) {
  // Commits on branches/tags x commits that only exist in refs/pull (a closed/merged PR keeps the old commit).
  const visible = scanCommits(git(dir, ['log', '--branches', '--tags', FORMAT]));
  const prOnly = scanCommits(git(dir, ['log', '--all', '--not', '--branches', '--tags', FORMAT]));
  const secrets = scanPatch(git(dir, ['log', '--all', '-p', '--no-color', '--no-ext-diff', '--format=commit %H']));
  const paths = [...new Set(git(dir, ['log', '--all', '--name-only', '--format=']).split('\n').filter(Boolean))];
  const { sensitive, priv } = suspiciousFiles(paths, privateItems);
  const pullRefs = git(dir, ['for-each-ref', 'refs/pull', '--format=%(refname)']).split('\n').filter(Boolean).length;
  return { coauthors: visible, coauthorsPrOnly: prOnly, secrets, sensitiveFiles: sensitive, privateItems: priv, pullRefs };
}

if (process.argv[1]?.endsWith('history.mjs')) {
  const folder = process.argv[2] || 'xray';
  const collected = JSON.parse(readFileSync(join(folder, 'collect.json'), 'utf8'));
  const privateItems = readPrivate(join(folder, 'private.txt'));
  const clones = join(folder, 'clones');
  mkdirSync(clones, { recursive: true });
  const result = { generatedAt: new Date().toISOString(), privateItems, repos: {} };
  for (const r of collected.repos.filter((x) => x.isPublic)) {
    const dir = join(clones, `${r.name}.git`);
    try {
      if (existsSync(dir)) git(dir, ['remote', 'update', '--prune']);
      else execFileSync('git', ['clone', '--mirror', '--quiet', `https://github.com/${r.full}.git`, dir], { stdio: 'pipe' });
      result.repos[r.name] = analyze(dir, privateItems);
      const a = result.repos[r.name];
      console.log(`ok  ${r.name}: ${a.secrets.length} secret(s), ${a.coauthors.length} commit(s) with co-author/bot, ${a.privateItems.length} private item(s)`);
    } catch (e) {
      result.repos[r.name] = { error: String(e.message).split('\n')[0] };
      console.log(`FAILED  ${r.name}: ${result.repos[r.name].error}`);
    }
  }
  writeFileSync(join(folder, 'history.json'), JSON.stringify(result, null, 2));
  console.log(`ok  ${join(folder, 'history.json')}`);
}

// Tests for the checks and the generator. Run: node skills/raio-x-github-en/scripts/test.mjs (needs bash on PATH)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit } from './audit.mjs';
import { scanCommits, scanPatch, suspiciousFiles } from './history.mjs';
import { generateScript } from './apply.mjs';

const NOW = Date.parse('2026-11-11');
const repo = (name, x = {}) => ({ name, full: `dev/${name}`, isPublic: true, fork: false, forkOf: null, archived: false,
  description: 'something', homepage: '', topics: ['dotnet'], language: 'C#', license: 'MIT', readmeBytes: 2000,
  lastPush: '2026-10-01T00:00:00Z', created: '2022-01-01T00:00:00Z', stars: 0, forks: 0, sizeKb: 10, ...x });
const collected = (profile, repos, pinned = []) => ({ collectedAt: '2026-11-11', contributionsLastYear: 0, pinned,
  profile: { login: 'dev', name: 'Dev', bio: 'bio', blog: 'https://x', company: '', location: '', socials: ['l'], profileReadme: true, ...profile }, repos });
const has = (a, re) => a.findings.some((x) => re.test(x.text));

test('empty bio', () => assert.ok(has(audit(collected({ bio: '' }, []), undefined, NOW), /Empty bio/)));

test('old public study repo becomes a private candidate', () => {
  const a = audit(collected({}, [repo('a'), repo('b'), repo('c'), repo('d'), repo('e'), repo('f'), repo('study', { lastPush: '2022-03-01T00:00:00Z', description: '' })]), undefined, NOW);
  assert.ok(has(a, /old public study repo/));
  assert.ok(a.plan.some((p) => p.type === 'private' && p.repo === 'study'));
});

test('product repo made public (interview list) by name and by file in history', () => {
  const h = { privateItems: ['skills-sale'], repos: { portfolio: { privateItems: [{ path: 'skills-sale-site/index.html', item: 'skills-sale' }] } } };
  const a = audit(collected({}, [repo('portfolio')]), h, NOW);
  assert.ok(a.findings.some((x) => x.severity === 'high' && /must not be public/.test(x.text)));
  assert.ok(a.plan.some((p) => p.type === 'private' && p.repo === 'portfolio'));
  assert.deepEqual(suspiciousFiles(['src/a.cs', 'skills-sale-site/x.md'], ['skills-sale']).priv.map((p) => p.path), ['skills-sale-site/x.md']);
});

test('Claude co-author on a commit, CI bot does not count', () => {
  const log = 'aaa\x1fDev\x1fd@x\x1ffeat: x\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\x1e' +
    'bbb\x1fgithub-actions[bot]\x1fb@x\x1fupdate readme\x1e' + 'ccc\x1fDev\x1fd@x\x1ffix: y\x1e';
  const c = scanCommits(log);
  assert.equal(c.length, 1);
  assert.match(c[0].reasons[0], /anthropic/);
  const a = audit(collected({}, [repo('app')]), { privateItems: [], repos: { app: { coauthors: c } } }, NOW);
  assert.ok(a.plan.some((p) => p.type === 'clean-coauthor'));
});

test('public fork: archives, never proposes private', () => {
  const a = audit(collected({}, [repo('course', { fork: true, forkOf: 'other/course' })]), undefined, NOW);
  assert.ok(has(a, /can't be made private/));
  assert.deepEqual(a.plan.map((p) => p.type), ['archive']);
});

test('secret: catches a real token, ignores examples and node_modules, masks the value', () => {
  const tok = 'ghp_' + 'a1B2'.repeat(9);
  assert.equal(scanPatch('commit abc\n+++ b/appsettings.json\n+"db": "Host=localhost;Password=secret123"')[0].certainty, 'local');
  const patch = ['commit 1234567890abcdef', '+++ b/src/config.js', `+const t = "${tok}"`, '+const k = "your_api_key_here_1234"',
    '+++ b/node_modules/x/crypto.js', '+-----BEGIN PRIVATE KEY-----'].join('\n');
  const s = scanPatch(patch);
  assert.equal(s.length, 1);
  assert.equal(s[0].rule, 'github-token');
  assert.ok(!JSON.stringify(s).includes(tok));
});

test('generator refuses to delete a repo', () => {
  assert.throws(() => generateScript({ login: 'dev', actions: [{ id: 1, type: 'delete', repo: 'x' }] }), /never deletes/);
});

test('apply.sh in dry-run does not call anything that changes the account', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xray-'));
  const log = join(dir, 'calls.log');
  // fake gh and git: log every call
  for (const bin of ['gh', 'git']) { writeFileSync(join(dir, bin), `#!/usr/bin/env bash\necho "${bin} $*" >> "${log.replace(/\\/g, '/')}"\n`); chmodSync(join(dir, bin), 0o755); }
  const plan = { login: 'dev', actions: [
    { id: 1, type: 'private', repo: 'a' }, { id: 2, type: 'archive', repo: 'b' }, { id: 3, type: 'description', repo: 'c', value: "it's", previous: '' },
    { id: 4, type: 'topics', repo: 'c', value: ['x', 'y'] }, { id: 5, type: 'profile', field: 'bio', value: 'new', previous: 'old' },
    { id: 6, type: 'clean-coauthor', repo: 'd' }, { id: 7, type: 'description', repo: 'e', pending: 'write it' }] };
  const sh = join(dir, 'apply.sh');
  writeFileSync(sh, generateScript(plan));
  const out = execFileSync('bash', [sh.replace(/\\/g, '/')], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` } });
  assert.match(out, /DRY RUN/);
  assert.equal((out.match(/undo:/g) || []).length, 6);
  assert.match(out, /skipped: pending/);
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  assert.ok(calls.includes('gh auth status'), 'fake gh was not used');
  assert.ok(calls.every((c) => c === 'gh auth status'), `called: ${calls.join(' | ')}`);
});

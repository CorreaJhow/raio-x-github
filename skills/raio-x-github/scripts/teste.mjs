// Testes das checagens e do gerador. Rodar: node --test scripts/teste.mjs (precisa de bash no PATH)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditar } from './auditoria.mjs';
import { escanearCommits, escanearPatch, arquivosSuspeitos } from './historico.mjs';
import { gerarScript } from './aplicar.mjs';

const HOJE = Date.parse('2026-11-11');
const repo = (nome, x = {}) => ({ nome, completo: `dev/${nome}`, publico: true, fork: false, forkDe: null, arquivado: false,
  descricao: 'algo', homepage: '', topics: ['dotnet'], linguagem: 'C#', licenca: 'MIT', readmeBytes: 2000,
  ultimoPush: '2026-10-01T00:00:00Z', criado: '2022-01-01T00:00:00Z', estrelas: 0, forks: 0, tamanhoKb: 10, ...x });
const coleta = (perfil, repos, fixados = []) => ({ coletadoEm: '2026-11-11', contribuicoesUltimoAno: 0, fixados,
  perfil: { login: 'dev', nome: 'Dev', bio: 'bio', blog: 'https://x', empresa: '', local: '', redes: ['l'], readmePerfil: true, ...perfil }, repos });
const tem = (a, re) => a.achados.some((x) => re.test(x.texto));

// Os 5 problemas achados à mão em 10/11 viram checagem:
test('bio vazia', () => assert.ok(tem(auditar(coleta({ bio: '' }, []), undefined, HOJE), /Bio vazia/)));

test('estudo velho público vira candidato a privado', () => {
  const a = auditar(coleta({}, [repo('a'), repo('b'), repo('c'), repo('d'), repo('e'), repo('f'), repo('estudo', { ultimoPush: '2022-03-01T00:00:00Z', descricao: '' })]), undefined, HOJE);
  assert.ok(tem(a, /estudo velho/));
  assert.ok(a.plano.some((p) => p.tipo === 'privado' && p.repo === 'estudo'));
});

test('repo de produto público (lista da entrevista) por nome e por arquivo no histórico', () => {
  const h = { privados: ['skills-sale'], repos: { portfolio: { itensPrivados: [{ caminho: 'skills-sale-site/index.html', item: 'skills-sale' }] } } };
  const a = auditar(coleta({}, [repo('portfolio')]), h, HOJE);
  assert.ok(a.achados.some((x) => x.severidade === 'alta' && /não pode ser público/.test(x.texto)));
  assert.ok(a.plano.some((p) => p.tipo === 'privado' && p.repo === 'portfolio'));
  assert.deepEqual(arquivosSuspeitos(['src/a.cs', 'skills-sale-site/x.md'], ['skills-sale']).priv.map((p) => p.caminho), ['skills-sale-site/x.md']);
});

test('co-autor do Claude no commit, bot de CI não conta', () => {
  const log = 'aaa\x1fDev\x1fd@x\x1ffeat: x\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\x1e' +
    'bbb\x1fgithub-actions[bot]\x1fb@x\x1fatualiza readme\x1e' + 'ccc\x1fDev\x1fd@x\x1ffix: y\x1e';
  const c = escanearCommits(log);
  assert.equal(c.length, 1);
  assert.match(c[0].motivos[0], /anthropic/);
  const a = auditar(coleta({}, [repo('app')]), { privados: [], repos: { app: { coautores: c } } }, HOJE);
  assert.ok(a.plano.some((p) => p.tipo === 'limpar-coautor'));
});

test('fork público: arquiva, nunca propõe privado', () => {
  const a = auditar(coleta({}, [repo('aula', { fork: true, forkDe: 'outro/aula' })]), undefined, HOJE);
  assert.ok(tem(a, /não vira privado/));
  assert.deepEqual(a.plano.map((p) => p.tipo), ['arquivar']);
});

test('segredo: pega token real, ignora exemplo e node_modules, mascara o valor', () => {
  const tok = 'ghp_' + 'a1B2'.repeat(9);
  assert.equal(escanearPatch('commit abc\n+++ b/appsettings.json\n+"db": "Host=localhost;Password=segredo123"')[0].certeza, 'local');
  const patch = ['commit 1234567890abcdef', '+++ b/src/config.js', `+const t = "${tok}"`, '+const k = "your_api_key_here_1234"',
    '+++ b/node_modules/x/crypto.js', '+-----BEGIN PRIVATE KEY-----'].join('\n');
  const s = escanearPatch(patch);
  assert.equal(s.length, 1);
  assert.equal(s[0].regra, 'github-token');
  assert.ok(!JSON.stringify(s).includes(tok));
});

test('gerador recusa apagar repo', () => {
  assert.throws(() => gerarScript({ login: 'dev', acoes: [{ id: 1, tipo: 'apagar', repo: 'x' }] }), /nunca apaga/);
});

test('aplicar.sh em dry-run não chama nada que muda a conta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'raiox-'));
  const log = join(dir, 'chamadas.log');
  // gh e git falsos: registram cada chamada
  for (const bin of ['gh', 'git']) { writeFileSync(join(dir, bin), `#!/usr/bin/env bash\necho "${bin} $*" >> "${log.replace(/\\/g, '/')}"\n`); chmodSync(join(dir, bin), 0o755); }
  const plano = { login: 'dev', acoes: [
    { id: 1, tipo: 'privado', repo: 'a' }, { id: 2, tipo: 'arquivar', repo: 'b' }, { id: 3, tipo: 'descricao', repo: 'c', valor: "it's", anterior: '' },
    { id: 4, tipo: 'topics', repo: 'c', valor: ['x', 'y'] }, { id: 5, tipo: 'perfil', campo: 'bio', valor: 'nova', anterior: 'velha' },
    { id: 6, tipo: 'limpar-coautor', repo: 'd' }, { id: 7, tipo: 'descricao', repo: 'e', pendente: 'escrever' }] };
  const sh = join(dir, 'aplicar.sh');
  writeFileSync(sh, gerarScript(plano));
  const out = execFileSync('bash', [sh.replace(/\\/g, '/')], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` } });
  assert.match(out, /SIMULAÇÃO/);
  assert.equal((out.match(/desfazer:/g) || []).length, 6);
  assert.match(out, /pulado: pendente/);
  const chamadas = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  assert.ok(chamadas.includes("gh auth status"), "gh falso não foi usado");
  assert.ok(chamadas.every((c) => c === 'gh auth status'), `chamou: ${chamadas.join(' | ')}`);
});

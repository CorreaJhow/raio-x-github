#!/usr/bin/env node
// Passo 4 (parte que precisa do histórico): clona cada repo público com --mirror (inclui refs/pull)
// e procura segredo, arquivo sensível, item da lista "não pode ser público" e co-autor indesejado.
// Uso: node historico.mjs [pasta=raio-x]   (lê pasta/coleta.json e pasta/privados.txt, grava pasta/historico.json)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REGRAS_SEGREDO = [
  ['chave-privada', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['aws', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['google-api', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['stripe', /\b[sr]k_live_[A-Za-z0-9]{20,}\b/],
  ['anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['openai', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/],
  ['connection-string', /(Password|Pwd)=[^;"'\s]{6,}/i],
  ['generico', /\b(api[_-]?key|secret|token|senha|password|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i],
];
// Valor de exemplo não conta como segredo.
const EXEMPLO = /(example|exemplo|sample|your[_-]|seu[_-]|xxx|\*\*\*|changeme|placeholder|<|\$\{|\{\{|process\.env|configuration\[)/i;
const ARQUIVO_SENSIVEL = /(^|\/)(\.env(\.[\w.-]+)?|id_rsa|id_ed25519|[^/]+\.(pem|pfx|p12|key|keystore|jks)|credentials\.json|service-account[^/]*\.json|secrets?\.(json|ya?ml))$/i;
const ENV_OK = /\.env\.(example|sample|template|exemplo)$/i;
const VENDOR = /(^|\/)(node_modules|vendor|bower_components|packages|dist)\//; // código de terceiro: não é segredo do dev
// github-actions e dependabot são automação legítima; o alvo é agente de IA assinando commit.
const BOT = /(anthropic|claude|copilot|cursor|openai|codex|devin)/i;

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
export const mascarar = (s) => `${s.slice(0, 4)}…(${s.length} chars)`;

export function escanearPatch(texto) {
  const achados = [];
  let commit = '', arquivo = '';
  for (const linha of texto.split('\n')) {
    if (linha.startsWith('commit ')) { commit = linha.slice(7, 19); continue; }
    if (linha.startsWith('+++ ')) { arquivo = linha.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (!linha.startsWith('+') || linha.length > 500 || VENDOR.test(arquivo)) continue; // linha minificada: pula
    for (const [regra, re] of REGRAS_SEGREDO) {
      const m = linha.match(re);
      if (!m) continue;
      const valor = m[2] ?? m[0];
      if (EXEMPLO.test(valor) || EXEMPLO.test(linha)) continue;
      achados.push({ regra, commit, arquivo, trecho: mascarar(valor), certeza: /localhost|127\.0\.0\.1|\(localdb\)/i.test(linha) ? 'local' : regra === 'generico' || regra === 'connection-string' ? 'suspeita' : 'alta' });
      break;
    }
  }
  return achados;
}

export function escanearCommits(texto) {
  // registro: hash \x1f autor \x1f email \x1f mensagem \x1e
  const out = [];
  for (const reg of texto.split('\x1e')) {
    const [hash, autor, email, msg = ''] = reg.replace(/^\s+/, '').split('\x1f');
    if (!hash) continue;
    const motivos = [];
    for (const m of msg.matchAll(/^Co-authored-by:\s*(.+)$/gim)) motivos.push(`co-autor: ${m[1].trim()}`);
    if (/Generated with \[?Claude Code/i.test(msg)) motivos.push('rodapé "Generated with Claude Code"');
    if (BOT.test(`${autor} ${email}`)) motivos.push(`autor bot: ${autor} <${email}>`);
    if (motivos.length) out.push({ commit: hash.slice(0, 12), motivos });
  }
  return out;
}

export function arquivosSuspeitos(caminhos, privados) {
  const sens = [], priv = [];
  for (const c of caminhos) {
    if (ARQUIVO_SENSIVEL.test(c) && !ENV_OK.test(c)) sens.push(c);
    const p = privados.find((x) => c.toLowerCase().includes(x));
    if (p) priv.push({ caminho: c, item: p });
  }
  return { sens, priv };
}

export const lerPrivados = (arq) => existsSync(arq)
  ? readFileSync(arq, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'))
  : [];

const FORMATO = '--format=%H%x1f%an%x1f%ae%x1f%B%x1e';

function analisar(dir, privados) {
  // Commits dos branches/tags x commits que só existem em refs/pull (PR fechado/mesclado guarda o commit antigo).
  const visiveis = escanearCommits(git(dir, ['log', '--branches', '--tags', FORMATO]));
  const soEmPr = escanearCommits(git(dir, ['log', '--all', '--not', '--branches', '--tags', FORMATO]));
  const segredos = escanearPatch(git(dir, ['log', '--all', '-p', '--no-color', '--no-ext-diff', '--format=commit %H']));
  const caminhos = [...new Set(git(dir, ['log', '--all', '--name-only', '--format=']).split('\n').filter(Boolean))];
  const { sens, priv } = arquivosSuspeitos(caminhos, privados);
  const refsPull = git(dir, ['for-each-ref', 'refs/pull', '--format=%(refname)']).split('\n').filter(Boolean).length;
  return { coautores: visiveis, coautoresSoEmPr: soEmPr, segredos, arquivosSensiveis: sens, itensPrivados: priv, refsPull };
}

if (process.argv[1]?.endsWith('historico.mjs')) {
  const pasta = process.argv[2] || 'raio-x';
  const coleta = JSON.parse(readFileSync(join(pasta, 'coleta.json'), 'utf8'));
  const privados = lerPrivados(join(pasta, 'privados.txt'));
  const clones = join(pasta, 'clones');
  mkdirSync(clones, { recursive: true });
  const resultado = { geradoEm: new Date().toISOString(), privados, repos: {} };
  for (const r of coleta.repos.filter((x) => x.publico)) {
    const dir = join(clones, `${r.nome}.git`);
    try {
      if (existsSync(dir)) git(dir, ['remote', 'update', '--prune']);
      else execFileSync('git', ['clone', '--mirror', '--quiet', `https://github.com/${r.completo}.git`, dir], { stdio: 'pipe' });
      resultado.repos[r.nome] = analisar(dir, privados);
      const a = resultado.repos[r.nome];
      console.log(`ok  ${r.nome}: ${a.segredos.length} segredo(s), ${a.coautores.length} commit(s) com co-autor/bot, ${a.itensPrivados.length} item(ns) privado(s)`);
    } catch (e) {
      resultado.repos[r.nome] = { erro: String(e.message).split('\n')[0] };
      console.log(`FALHOU  ${r.nome}: ${resultado.repos[r.nome].erro}`);
    }
  }
  writeFileSync(join(pasta, 'historico.json'), JSON.stringify(resultado, null, 2));
  console.log(`ok  ${join(pasta, 'historico.json')}`);
}

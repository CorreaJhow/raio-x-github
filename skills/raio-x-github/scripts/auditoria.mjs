#!/usr/bin/env node
// Passos 4 e 5: cruza coleta.json + historico.json, dá nota por eixo e propõe o plano de ações.
// Uso: node auditoria.mjs [pasta=raio-x]  -> grava auditoria.json, plano.json e RELATORIO.md (esqueleto)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ANOS_ESTUDO_VELHO = 2;
const ANO_MS = 365 * 24 * 3600 * 1000;
const arred = (n) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;

const qualidadeRepo = (r, hoje) =>
  (r.descricao ? 0.3 : 0) + (r.readmeBytes > 300 ? 0.3 : 0) + (r.topics.length ? 0.2 : 0) +
  (r.licenca ? 0.1 : 0) + (hoje - Date.parse(r.ultimoPush) < ANO_MS ? 0.1 : 0);

export function auditar(coleta, historico = { repos: {}, privados: [] }, hoje = Date.now()) {
  const { perfil } = coleta;
  const achados = [];
  const plano = [];
  const achar = (eixo, severidade, repo, texto) => achados.push({ eixo, severidade, repo, texto });
  const propor = (acao) => plano.push({ id: plano.length + 1, ...acao });
  const login = perfil.login.toLowerCase();
  const fixados = new Set(coleta.fixados.map((f) => f.split('/')[1]?.toLowerCase()));
  const publicos = coleta.repos.filter((r) => r.publico);
  const vitrine = publicos.filter((r) => !r.fork && !r.arquivado && r.nome.toLowerCase() !== login);
  const fixadosSugeridos = vitrine
    .map((r) => ({ nome: r.nome, pontos: qualidadeRepo(r, hoje) * 10 + Math.min(r.estrelas, 20) / 4 }))
    .sort((a, b) => b.pontos - a.pontos).slice(0, 6).map((r) => r.nome);
  // O que está (ou deveria estar) fixado não é estudo velho.
  const vitrineBoa = new Set([...fixados, ...fixadosSugeridos.map((n) => n.toLowerCase())]);

  // Perfil
  if (!perfil.bio.trim()) { achar('perfil', 'alta', null, 'Bio vazia: é a primeira coisa que o recrutador lê.'); propor({ tipo: 'perfil', campo: 'bio', valor: '', anterior: '', pendente: 'escrever a bio com o dev (até 160 caracteres)', motivo: 'bio vazia' }); }
  if (!perfil.nome.trim()) achar('perfil', 'media', null, 'Nome de exibição vazio.');
  if (!perfil.blog) achar('perfil', 'baixa', null, 'Sem site/portfólio no perfil.');
  if (!perfil.redes.length) achar('perfil', 'baixa', null, 'Sem LinkedIn/redes ligados ao perfil.');
  if (!perfil.readmePerfil) achar('perfil', 'media', null, `Sem README de perfil (repo público ${perfil.login}/${perfil.login}).`);
  if (coleta.fixados.length < 4) achar('vitrine', 'media', null, `Só ${coleta.fixados.length} repo(s) fixado(s); o perfil aceita 6.`);

  const itemPrivado = (nome) => historico.privados.find((p) => nome.toLowerCase().includes(p));

  for (const r of publicos) {
    const h = historico.repos[r.nome] ?? {};
    const idade = (hoje - Date.parse(r.ultimoPush)) / ANO_MS;

    // Segurança
    const priv = itemPrivado(r.nome) ?? h.itensPrivados?.[0]?.item;
    if (priv) {
      const onde = h.itensPrivados?.length ? ` (ex.: ${h.itensPrivados.slice(0, 3).map((i) => i.caminho).join(', ')})` : '';
      achar('seguranca', 'alta', r.nome, `Item da lista "não pode ser público" (${priv}) em repo público${onde}.`);
      if (!r.fork) propor({ tipo: 'privado', repo: r.nome, motivo: `contém "${priv}"` });
    }
    for (const s of dedupe(h.segredos ?? [])) {
      const firebase = s.regra === 'google-api' && /firebase/i.test(s.arquivo);
      const sev = s.certeza === 'local' ? 'baixa' : firebase || s.certeza === 'suspeita' ? 'media' : 'alta';
      const extra = s.certeza === 'local' ? ' Banco local (localhost): risco baixo, mas troque a senha se ela for reaproveitada em outro lugar e use user-secrets/variável de ambiente.' : firebase ? ' Chave web do Firebase é pública por design: confira regras do banco e restrição de domínio.' : ' Revogue/troque a chave antes de qualquer coisa: reescrever histórico não desfaz o vazamento (forks e caches já viram).';
      achar('seguranca', sev, r.nome, `Possível segredo (${s.regra}, ${s.certeza}) em ${s.arquivo} no commit ${s.commit}: ${s.trecho}.${extra}`);
    }
    for (const f of h.arquivosSensiveis ?? []) achar('seguranca', 'alta', r.nome, `Arquivo sensível no histórico: ${f}.`);
    if (h.coautores?.length) {
      const ex = h.coautores[0].motivos[0];
      achar('seguranca', 'media', r.nome, `${h.coautores.length} commit(s) com co-autor/assinatura indesejada nos branches (ex.: ${ex}).`);
      propor({ tipo: 'limpar-coautor', repo: r.nome, motivo: `${h.coautores.length} commit(s) com ${ex}` });
    }
    if (h.coautoresSoEmPr?.length) {
      achar('seguranca', 'media', r.nome, `${h.coautoresSoEmPr.length} commit(s) com co-autor indesejado só em refs de PR (${h.refsPull} refs/pull). Reescrever histórico não limpa PR fechado: só pedindo ao suporte do GitHub ou deixando o repo privado.`);
    }
    if (h.erro) achar('seguranca', 'media', r.nome, `Não consegui varrer o histórico: ${h.erro}`);
    if (r.fork) {
      achar('seguranca', 'baixa', r.nome, `Fork público${r.arquivado ? ' (já arquivado)' : ''} de ${r.forkDe ?? '?'}: fork público não vira privado; as opções são arquivar ou apagar (apagar só o dev, na mão).`);
      if (!r.arquivado) propor({ tipo: 'arquivar', repo: r.nome, motivo: 'fork público não pode virar privado' });
      continue;
    }
    if (r.nome.toLowerCase() === login || r.arquivado) continue;

    // Qualidade
    if (idade > ANOS_ESTUDO_VELHO && !vitrineBoa.has(r.nome.toLowerCase()) && !priv) {
      achar('qualidade', 'media', r.nome, `Sem push há ${idade.toFixed(1)} anos e fora da vitrine: estudo velho público? Candidato a privado.`);
      propor({ tipo: 'privado', repo: r.nome, motivo: `parado há ${idade.toFixed(1)} anos` });
    }
    if (!r.descricao) { achar('qualidade', 'media', r.nome, 'Sem descrição.'); propor({ tipo: 'descricao', repo: r.nome, valor: '', anterior: '', pendente: 'escrever descrição de 1 frase', motivo: 'sem descrição' }); }
    if (!r.topics.length) { achar('qualidade', 'baixa', r.nome, 'Sem topics (atrapalha a busca).'); propor({ tipo: 'topics', repo: r.nome, valor: [], pendente: 'escolher 3-6 topics', motivo: 'sem topics' }); }
    if (r.readmeBytes < 300) achar('qualidade', 'media', r.nome, r.readmeBytes ? 'README curto demais (menos de 300 bytes).' : 'Sem README.');
  }

  // Notas por eixo
  const notaPerfil = (perfil.bio.trim() ? 3 : 0) + (perfil.readmePerfil ? 3 : 0) + (perfil.nome.trim() ? 1 : 0) +
    (perfil.blog ? 1 : 0) + (perfil.redes.length ? 1 : 0) + (perfil.local || perfil.empresa ? 1 : 0);
  const porNome = new Map(coleta.repos.map((r) => [r.nome.toLowerCase(), r]));
  const pins = [...fixados].map((n) => porNome.get(n)).filter(Boolean);
  const notaVitrine = (10 * pins.reduce((s, r) => s + (r.publico ? qualidadeRepo(r, hoje) : 0), 0)) / 6;
  const notaQualidade = vitrine.length ? (10 * vitrine.reduce((s, r) => s + qualidadeRepo(r, hoje), 0)) / vitrine.length : 0;
  const peso = { alta: 3, media: 1, baixa: 0.5 };
  const notaSeguranca = 10 - achados.filter((a) => a.eixo === 'seguranca').reduce((s, a) => s + peso[a.severidade], 0);
  const notas = {
    perfil: arred(notaPerfil), vitrine: arred(notaVitrine), qualidade: arred(notaQualidade), seguranca: arred(notaSeguranca),
    alinhamento: null, // o Claude preenche com a entrevista + tendências (passo 3)
  };

  return { notas, achados, plano, fixadosSugeridos };
}

function dedupe(segredos) {
  const vistos = new Set();
  return segredos.filter((s) => { const k = `${s.regra}|${s.arquivo}|${s.trecho}`; return !vistos.has(k) && vistos.add(k); });
}

export function relatorio(coleta, a) {
  const media = Object.values(a.notas).filter((n) => n !== null);
  const geral = arred(media.reduce((s, n) => s + n, 0) / media.length);
  const ordem = { alta: 0, media: 1, baixa: 2 };
  const linhas = [...a.achados].sort((x, y) => ordem[x.severidade] - ordem[y.severidade])
    .map((x) => `| ${x.severidade} | ${x.eixo} | ${x.repo ?? 'perfil'} | ${x.texto.replace(/\|/g, '\\|')} |`);
  return `# Raio-x do GitHub — ${coleta.perfil.login}

Coletado em ${coleta.coletadoEm.slice(0, 10)} · ${coleta.repos.length} repos (${coleta.repos.filter((r) => r.publico).length} públicos) · ${coleta.contribuicoesUltimoAno} contribuições no último ano

## Nota: ${geral}/10 (sem o eixo alinhamento)

| Eixo | Nota |
|---|---|
| Perfil (bio, README, links) | ${a.notas.perfil} |
| Vitrine (fixados) | ${a.notas.vitrine} |
| Qualidade dos repos públicos | ${a.notas.qualidade} |
| Segurança | ${a.notas.seguranca} |
| Alinhamento com o objetivo | <!-- preencher: nota 0-10 + 1 frase, a partir de perfil.md e das tendências --> |

## Achados (${a.achados.length})

| Severidade | Eixo | Onde | O quê |
|---|---|---|---|
${linhas.join('\n') || '| — | — | — | nada encontrado |'}

## Fixados sugeridos (a API não deixa fixar: Perfil > Customize your pins)
${a.fixadosSugeridos.map((n, i) => `${i + 1}. ${n}`).join('\n')}

## Tendências do cargo
<!-- preencher: o que recrutador e comunidade esperam ver pro cargo/nível + 2-3 perfis de referência (com link) -->

## O que mudar e por quê
<!-- preencher: as 3-5 mudanças de maior impacto, na ordem -->

## Plano de próximos repos
| Fase | Prazo | Repo | Por quê |
|---|---|---|---|
<!-- preencher: 3-5 linhas por cargo/nível/stack -->

## Como aplicar
\`bash raio-x/aplicar.sh\` mostra o que faria (dry-run). \`bash raio-x/aplicar.sh --aplicar\` executa. Cada passo imprime como desfazer.
`;
}

if (process.argv[1]?.endsWith('auditoria.mjs')) {
  const pasta = process.argv[2] || 'raio-x';
  const coleta = JSON.parse(readFileSync(join(pasta, 'coleta.json'), 'utf8'));
  const hArq = join(pasta, 'historico.json');
  const historico = existsSync(hArq) ? JSON.parse(readFileSync(hArq, 'utf8')) : (console.log('aviso: sem historico.json, segurança do histórico não foi checada'), undefined);
  const a = auditar(coleta, historico);
  writeFileSync(join(pasta, 'auditoria.json'), JSON.stringify(a, null, 2));
  writeFileSync(join(pasta, 'plano.json'), JSON.stringify({ login: coleta.perfil.login, acoes: a.plano }, null, 2));
  writeFileSync(join(pasta, 'RELATORIO.md'), relatorio(coleta, a));
  console.log(`ok  notas ${JSON.stringify(a.notas)} · ${a.achados.length} achados · ${a.plano.length} ações propostas`);
}

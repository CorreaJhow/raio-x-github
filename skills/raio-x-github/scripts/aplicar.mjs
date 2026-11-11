#!/usr/bin/env node
// Passo 6: transforma plano.json (revisado com o dev) em aplicar.sh.
// O script gerado simula por padrão; só executa com --aplicar. Nunca apaga repo.
// Uso: node aplicar.mjs [pasta=raio-x]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const CAMPOS_PERFIL = { bio: '-f bio', blog: '-f blog', nome: '-f name', empresa: '-f company', local: '-f location', contratavel: '-F hireable' };

function passo(a, U) {
  const R = `"$U/${a.repo}"`;
  switch (a.tipo) {
    case 'privado':
      return `rodar ${q(`gh repo edit ${U}/${a.repo} --visibility public --accept-visibility-change-consequences`)} gh repo edit ${R} --visibility private --accept-visibility-change-consequences`;
    case 'arquivar':
      return `rodar ${q(`gh repo unarchive ${U}/${a.repo} --yes`)} gh repo archive ${R} --yes`;
    case 'descricao':
      return `rodar ${q(`gh repo edit ${U}/${a.repo} --description ${q(a.anterior ?? '')}`)} gh repo edit ${R} --description ${q(a.valor)}`;
    case 'homepage':
      return `rodar ${q(`gh repo edit ${U}/${a.repo} --homepage ${q(a.anterior ?? '')}`)} gh repo edit ${R} --homepage ${q(a.valor)}`;
    case 'topics': {
      const t = [].concat(a.valor).join(',');
      return `rodar ${q(`gh repo edit ${U}/${a.repo} --remove-topic ${t}`)} gh repo edit ${R} --add-topic ${q(t)}`;
    }
    case 'perfil': {
      const f = CAMPOS_PERFIL[a.campo];
      if (!f) throw new Error(`campo de perfil desconhecido: ${a.campo}`);
      return `escopo_user\nrodar ${q(`gh api -X PATCH user ${f}=${q(a.anterior ?? '')}`)} gh api -X PATCH user ${f}=${q(a.valor)}`;
    }
    case 'limpar-coautor':
      return `limpar_coautor ${q(a.repo)}`;
    default:
      throw new Error(`tipo de ação não suportado: ${a.tipo} (o raio-x nunca apaga repo)`);
  }
}

export function gerarScript(plano, agora = new Date()) {
  const corpo = plano.acoes.map((a) => {
    const titulo = `passo ${q(`${a.id}. ${a.tipo}${a.repo ? ` ${a.repo}` : ` ${a.campo}`}: ${a.motivo ?? ''}`)}`;
    if (a.pendente) return `${titulo}\necho "  pulado: pendente (${String(a.pendente).replace(/"/g, "'")})"`;
    return `${titulo}\n${passo(a, plano.login)}`;
  });
  return `#!/usr/bin/env bash
# Gerado pelo raio-x-github em ${agora.toISOString().slice(0, 16).replace('T', ' ')}. Revise antes de rodar.
#   bash aplicar.sh            -> só mostra o que faria (nada muda)
#   bash aplicar.sh --aplicar  -> executa
# Nenhum passo apaga repo. Cada passo imprime como desfazer.
set -u
U=${q(plano.login)}
APLICAR=0; [ "\${1:-}" = "--aplicar" ] && APLICAR=1
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ $APLICAR = 1 ] && echo "MODO APLICAR: vai mudar a conta $U" || echo "SIMULAÇÃO (dry-run): nada será alterado. Use --aplicar pra executar."

passo() { echo; echo "== $1"; }
# rodar <desfazer> <comando...>
rodar() {
  local desfazer=$1; shift
  echo "  comando:  $(printf '%q ' "$@")"
  echo "  desfazer: $desfazer"
  [ $APLICAR = 1 ] || return 0
  "$@" >/dev/null && echo "  ok" || echo "  FALHOU"
}
# Mudar o perfil pede o escopo 'user' do gh, que abre login no navegador uma vez.
escopo_user() {
  gh auth status 2>&1 | grep -q "'user'" && return 0
  echo "  aviso: falta o escopo 'user' do gh; com --aplicar vai abrir o navegador pra autorizar"
  [ $APLICAR = 1 ] && gh auth refresh -h github.com -s user
}
# Tira co-autor/rodapé de IA das mensagens de commit (branches e tags), com backup --mirror antes.
limpar_coautor() {
  local repo=$1 url="https://github.com/$U/$1.git"
  local bkp="$AQUI/backup/$repo-$(date +%Y%m%d-%H%M%S).git" tmp="$AQUI/reescrita/$repo.git"
  echo "  backup:    git clone --mirror $url $bkp"
  echo "  reescreve: git filter-branch --msg-filter (tira Co-authored-by de IA e 'Generated with Claude Code')"
  echo "  publica:   git push --force $url (branches e tags)"
  echo "  desfazer:  git -C $bkp push --force $url 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'"
  echo "  atenção:   commits antigos em PR fechado (refs/pull) continuam no GitHub; cópias locais precisam de fetch + reset"
  [ $APLICAR = 1 ] || return 0
  git clone --mirror -q "$url" "$bkp" || { echo "  FALHOU backup: nada mudou"; return 1; }
  rm -rf "$tmp"
  # bare a partir do backup: sem refs/pull e sem a flag mirror (push de clone --mirror não aceita refspec)
  git clone --bare -q "$bkp" "$tmp"
  FILTER_BRANCH_SQUELCH_WARNING=1 git -C "$tmp" filter-branch -f --msg-filter \\
    "{ grep -viE '^co-authored-by:.*(anthropic|claude|copilot|cursor|openai|codex|devin)|generated with \\\\[?claude code' || true; }" \\
    -- --branches --tags >/dev/null || { echo "  FALHOU reescrita: nada mudou no GitHub"; return 1; }
  git -C "$tmp" push --force -q "$url" 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*' && echo "  ok" || echo "  FALHOU push"
}

${corpo.join('\n\n')}

echo
[ $APLICAR = 1 ] && echo "Feito." || echo "Fim da simulação: nada foi alterado."
echo "Na mão (a API não deixa): fixados em Perfil > Customize your pins (lista no RELATORIO.md)."
`;
}

if (process.argv[1]?.endsWith('aplicar.mjs')) {
  const pasta = process.argv[2] || 'raio-x';
  const plano = JSON.parse(readFileSync(join(pasta, 'plano.json'), 'utf8'));
  writeFileSync(join(pasta, 'aplicar.sh'), gerarScript(plano), { mode: 0o755 });
  const pend = plano.acoes.filter((a) => a.pendente).length;
  console.log(`ok  ${join(pasta, 'aplicar.sh')}: ${plano.acoes.length} passo(s), ${pend} pendente(s)`);
}

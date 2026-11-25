# GitHub X-Ray (raio-x-github): skill do Claude Code

[English](README.md) | **Português (BR)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Node 18+](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org) [![GitHub stars](https://img.shields.io/github/stars/CorreaJhow/raio-x-github?style=social)](https://github.com/CorreaJhow/raio-x-github)

Skill do [Claude Code](https://code.claude.com) que faz um raio-x do seu GitHub: audita perfil, repos e a **segurança de todo o histórico de commits**, dá nota por eixo e gera um script que você revisa antes de qualquer mudança.

**Nada sai do seu PC, e nada muda até você rodar o script.**

## O que ela faz
1. **Entrevista** curta, uma pergunta por vez: cargo, nível, objetivo (CLT, freela, conteúdo, open source) e o que **não pode** ficar público.
2. **Coleta só leitura** via `gh`: perfil, bio, repos, README, topics, fixados, contribuições.
3. **Tendências** do seu cargo e nível, com perfis de referência.
4. **Auditoria de segurança** em todo o histórico dos repos públicos, inclusive refs de PR:
   - segredo commitado (chaves AWS, GitHub, Google, OpenAI, Anthropic, Stripe, chave privada, connection string...);
   - arquivo de produto pago ou de cliente em repo público (a partir da sua lista);
   - co-autor de IA no commit (`Co-authored-by: Claude...`, Copilot, Cursor);
   - fork público (não dá pra deixar privado) e commit antigo preso em PR fechado.
5. **Nota de 0 a 10** para perfil, fixados, qualidade dos repos, segurança e alinhamento com o objetivo.
6. **`aplicar.sh`**: simula por padrão, só executa com `--aplicar`, mostra como desfazer cada passo, faz backup `--mirror` antes de reescrever histórico e **nunca apaga repo**. Mais um plano dos seus próximos 3-5 repos.

## Requisitos
Claude Code, [`gh`](https://cli.github.com) autenticado (`gh auth login`), `git`, Node 18+ e `bash` (no Windows, Git Bash).

## Instalação
```text
/plugin marketplace add CorreaJhow/raio-x-github
/plugin install raio-x-github@raio-x-github
```
Instala duas skills: `raio-x-github` (português) e `github-xray` (inglês).

Instalação manual da skill em português:
```bash
git clone https://github.com/CorreaJhow/raio-x-github.git
cp -r raio-x-github/skills/raio-x-github ~/.claude/skills/raio-x-github
```

## Uso
Numa pasta qualquer, peça ao Claude: *"faz um raio-x do meu GitHub"*, *"o que um recrutador vê no meu GitHub?"* ou *"tem segredo vazado nos meus repos?"* e responda a entrevista. A saída vai pra `raio-x/`.

> Ponha `raio-x/` no `.gitignore`: tem dados da sua conta.

## Exemplo de saída
```text
$ node scripts/auditoria.mjs
ok  notas {"perfil":7,"vitrine":4.7,"qualidade":6.2,"seguranca":4,"alinhamento":null} · 14 achados · 6 ações propostas
```

`raio-x/RELATORIO.md` (trecho):

| Severidade | Eixo | Onde | O quê |
|---|---|---|---|
| alta | seguranca | portfolio | Item da lista "não pode ser público" (curso-pago) em repo público (ex.: curso-pago/aula1.md). |
| media | seguranca | api-loja | 12 commit(s) com co-autor/assinatura indesejada nos branches (ex.: co-autor: Claude <noreply@anthropic.com>). |
| media | qualidade | PrimeiroCrud | Sem push há 4.0 anos e fora da vitrine: estudo velho público? Candidato a privado. |

`bash raio-x/aplicar.sh` (dry-run):
```text
SIMULAÇÃO (dry-run): nada será alterado. Use --aplicar pra executar.

== 1. privado portfolio: contém "curso-pago"
  comando:  gh repo edit dev/portfolio --visibility private --accept-visibility-change-consequences
  desfazer: gh repo edit dev/portfolio --visibility public --accept-visibility-change-consequences
```

## Os scripts
Em `skills/raio-x-github/scripts/`, sem dependência:

| Script | Faz | Grava |
|---|---|---|
| `coleta.mjs` | lê a conta via `gh` | `raio-x/coleta.json` |
| `historico.mjs` | clona os públicos e varre o histórico | `raio-x/historico.json` |
| `auditoria.mjs` | notas, achados e plano | `auditoria.json`, `plano.json`, `RELATORIO.md` |
| `aplicar.mjs` | gera o script a partir do plano revisado | `raio-x/aplicar.sh` |

Testes: `node --test skills/raio-x-github/scripts/teste.mjs`

## Regras de segurança
- Nunca apaga repo: no máximo privado ou arquivado, com o seu aval.
- Nunca roda `aplicar.sh --aplicar` sozinha: você revisa o dry-run e roda.
- Reescrever histórico não limpa PR fechado nem desfaz vazamento: **revogue o segredo vazado primeiro**.
- Segredos saem mascarados em toda a saída (`AIza…(39 chars)`).

## Fora do escopo (v1)
README de perfil com design (só sugere texto), GitLab/Bitbucket, organizações.

## Licença
MIT. Veja [LICENSE](LICENSE).

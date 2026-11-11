# raio-x-github

Skill do [Claude Code](https://code.claude.com) em PT-BR que faz um raio-x do seu GitHub: entende o seu objetivo, audita perfil, repos e **segurança do histórico**, dá nota por eixo e gera um script revisável que aplica as mudanças.

Nunca mais seu GitHub desatualizado.

## O que ela faz
1. **Entrevista** curta, uma pergunta por vez: cargo, nível, objetivo (CLT, freela, conteúdo, open source) e o que **não pode** ficar público.
2. **Coleta via `gh`** (só leitura): perfil, bio, repos, README, topics, fixados, contribuições.
3. **Tendências** do seu cargo/nível e perfis de referência.
4. **Auditoria de segurança** em todo o histórico dos repos públicos, inclusive refs de PR:
   - segredo commitado (chaves AWS, GitHub, Google, OpenAI, Anthropic, Stripe, chave privada, connection string...);
   - arquivo de produto ou de cliente em repo público (a partir da sua lista);
   - co-autor de IA no commit (`Co-authored-by: Claude...`, Copilot, Cursor);
   - fork público (não dá pra deixar privado) e commit antigo preso em PR fechado.
5. **Diagnóstico com nota** 0-10: perfil, vitrine (fixados), qualidade dos repos, segurança e alinhamento com o objetivo.
6. **`aplicar.sh`**: simula por padrão, só executa com `--aplicar`, cada passo mostra como desfazer, faz backup `--mirror` antes de reescrever histórico e **nunca apaga repo**. Mais um plano dos seus próximos 3-5 repos.

Nada sai do seu PC: coleta, clones e relatório ficam na pasta `raio-x/`.

## Instalar
Requisitos: Claude Code, [`gh`](https://cli.github.com) autenticado (`gh auth login`), `git`, Node 18+ e `bash` (no Windows, Git Bash).

```text
/plugin marketplace add CorreaJhow/raio-x-github
/plugin install raio-x-github@raio-x-github
```

Depois, numa pasta qualquer: "faz um raio-x do meu GitHub".

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
| baixa | seguranca | AulaEF | Fork público de professor/AulaEF: fork público não vira privado; as opções são arquivar ou apagar. |

`bash raio-x/aplicar.sh` (dry-run):

```text
SIMULAÇÃO (dry-run): nada será alterado. Use --aplicar pra executar.

== 1. privado portfolio: contém "curso-pago"
  comando:  gh repo edit dev/portfolio --visibility private --accept-visibility-change-consequences
  desfazer: gh repo edit dev/portfolio --visibility public --accept-visibility-change-consequences

== 2. limpar-coautor api-loja: 12 commit(s) com co-autor: Claude <noreply@anthropic.com>
  backup:    git clone --mirror https://github.com/dev/api-loja.git raio-x/backup/api-loja-20261111-101500.git
  reescreve: git filter-branch --msg-filter (tira Co-authored-by de IA e 'Generated with Claude Code')
  publica:   git push --force https://github.com/dev/api-loja.git (branches e tags)
  desfazer:  git -C raio-x/backup/api-loja-20261111-101500.git push --force ... 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'
```

## Os scripts
Ficam em `skills/raio-x-github/scripts/` e rodam sem dependência:

| Script | Faz | Grava |
|---|---|---|
| `coleta.mjs` | lê a conta via `gh` | `raio-x/coleta.json` |
| `historico.mjs` | clona os públicos e varre o histórico | `raio-x/historico.json` |
| `auditoria.mjs` | notas, achados e plano | `auditoria.json`, `plano.json`, `RELATORIO.md` |
| `aplicar.mjs` | gera o script a partir do plano revisado | `raio-x/aplicar.sh` |

Testes: `node --test skills/raio-x-github/scripts/teste.mjs`.

## Fora do escopo (v1)
Gerar README de perfil com design (só sugere texto), GitLab/Bitbucket, organizações.

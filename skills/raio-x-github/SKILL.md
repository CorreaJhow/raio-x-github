---
name: raio-x-github
description: Use quando o dev pedir um raio-x, auditoria, faxina ou revisão do próprio GitHub ("arruma meu GitHub", "meu perfil tá desatualizado", "o que um recrutador vê no meu GitHub", "tem segredo vazado nos meus repos?"). Entrevista, coleta via gh, audita perfil, repos e segurança do histórico, dá nota por eixo e gera um aplicar.sh revisável (dry-run por padrão) + plano dos próximos repos.
---

# Raio-x do GitHub

Faz um raio-x da conta pessoal do GitHub do dev e entrega `raio-x/RELATORIO.md` + `raio-x/aplicar.sh`. Tudo fica no PC do dev: nada é enviado pra fora, e a pasta `raio-x/` tem dados pessoais (avise pra não commitar; sugira pôr no `.gitignore`).

Scripts em `scripts/`, ao lado deste arquivo (Node 18+, sem dependências). Rode a partir da pasta onde o dev quer o `raio-x/`. Requisitos: `gh` autenticado (`gh auth status`), `git` e `bash` (no Windows, Git Bash).

## Regras (aprendidas na prática)
- **Nunca apagar repo.** No máximo privado ou arquivado, e só com o aval do dev. O gerador recusa `apagar`.
- **Nunca rodar `aplicar.sh --aplicar` sozinho.** Mostre o dry-run, o dev revisa e roda.
- **Fork público não vira privado**: só arquivar (ou o dev apaga na mão).
- **Fixados não mudam pela API**: liste quais fixar; o dev faz em Perfil > Customize your pins.
- **Mudar bio/perfil pede o escopo `user` do `gh`**, que abre login no navegador: avise antes.
- **Reescrever histórico não limpa PR fechado** (`refs/pull/*` guarda o commit antigo) nem desfaz vazamento: segredo vazado se **revoga** primeiro.
- **`git push` de clone `--mirror` não aceita refspec**: o script reescreve num clone `--bare` feito a partir do backup `--mirror`.
- Nunca mostre um segredo inteiro: os scripts já mascaram (`AIza…(39 chars)`).

## Fluxo

### 1. Entrevista (uma pergunta por vez, espere a resposta)
1. Cargo e stack principal?
2. Senioridade (júnior, pleno, sênior, lead)?
3. Onde trabalha hoje / o que faz no dia a dia? (pode pular)
4. Objetivo com o GitHub: vaga CLT, freela, conteúdo, open source? (pode ser mais de um)
5. O que **não pode** ficar público? Produto pago, código de cliente, empresa, nomes de projeto, pastas. Peça nomes ou pedaços de nome.

Grave `raio-x/perfil.md` (respostas) e `raio-x/privados.txt` (um item da pergunta 5 por linha, minúsculo, `#` comenta). Os itens casam com nome de repo e com qualquer caminho de arquivo já commitado.

### 2. Coleta (só leitura)
```bash
node <scripts>/coleta.mjs        # -> raio-x/coleta.json
```
Perfil, bio, redes, repos (visibilidade, descrição, topics, README, último push, linguagem, licença, fork, arquivado), fixados e contribuições. Navegador só se o dev pedir print do perfil.

### 3. Tendências do cargo/nível
Pesquisa web curta (3-5 buscas): o que recrutador e comunidade esperam ver no GitHub pro cargo + nível + stack da entrevista, e 2-3 perfis de referência parecidos (com link). Sem inventar: só o que a fonte diz.

### 4. Auditoria de segurança
```bash
node <scripts>/historico.mjs     # clona os repos públicos com --mirror em raio-x/clones/ -> raio-x/historico.json
```
Procura em todo o histórico (inclusive refs de PR): segredo (chave privada, AWS, GitHub, Google, Slack, Stripe, OpenAI, Anthropic, connection string, `senha=`), arquivo sensível (`.env`, `.pem`, `id_rsa`...), item do `privados.txt`, co-autor/assinatura de IA no commit (`Co-authored-by` de Claude/Copilot/Cursor..., "Generated with Claude Code"). Bot de CI (github-actions, dependabot) não conta. Avise que pode demorar em conta com muitos repos.

### 5. Diagnóstico com nota
```bash
node <scripts>/auditoria.mjs     # -> raio-x/auditoria.json, raio-x/plano.json, raio-x/RELATORIO.md
```
Nota 0-10 por eixo: perfil, vitrine (fixados), qualidade dos repos públicos, segurança. Também aponta estudo velho público (sem push há 2+ anos e fora da vitrine), repo sem descrição/topics/README, bio vazia, fork público.
Depois **complete o RELATORIO.md** nos `<!-- preencher -->`: nota de alinhamento com o objetivo, tendências, as 3-5 mudanças de maior impacto, e o plano de próximos repos (3-5 linhas, tabela Fase · Prazo · Repo · Por quê, pelo cargo/nível/stack). Achado `suspeita` você confere abrindo o arquivo no clone antes de afirmar.

### 6. Script de aplicação
Revise `raio-x/plano.json` com o dev, uma ação por vez:
- tire o que ele não quer (ex.: estudo velho que ele gosta);
- preencha `valor` e apague `pendente` nas ações de texto (bio, descrição, topics). Ação com `pendente` é pulada;
- pode adicionar ações: `privado`, `arquivar`, `descricao`, `homepage`, `topics` (lista), `perfil` (`campo`: bio, blog, nome, empresa, local, contratavel), `limpar-coautor`. Guarde o valor antigo em `anterior` pra o desfazer funcionar.
```bash
node <scripts>/aplicar.mjs       # -> raio-x/aplicar.sh
bash raio-x/aplicar.sh           # dry-run: mostra comando e desfazer de cada passo, não muda nada
```
Mostre o dry-run. Quem roda `bash raio-x/aplicar.sh --aplicar` é o dev. `limpar-coautor` faz backup `--mirror` em `raio-x/backup/` antes do force push.

## Entrega
Resposta curta: nota geral, os 3 achados mais graves, o que o `aplicar.sh` faz, o que é na mão (fixados, revogar segredo, apagar fork) e o caminho do RELATORIO.md. No fim, lembre: `raio-x/` tem dados pessoais e os clones podem ser apagados.

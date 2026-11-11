# SPEC — `raio-x-github` v1

## Objetivo
Skill do Claude Code, em PT-BR, que faz um raio-x do GitHub de qualquer dev: entende o objetivo dele, audita perfil e repos (inclusive segurança), dá nota e gera um script revisável que aplica as mudanças.

## Pra quem
Dev brasileiro que usa Claude Code e tem o GitHub bagunçado (estudo velho público, repo sem descrição, bio vazia). Qualquer stack.

## Fluxo (6 passos)
1. **Entrevista**, uma pergunta por vez: cargo, senioridade, trabalho atual, objetivo (CLT, freela, conteúdo, open source) e o que **não pode** ficar público. Vai pra `raio-x/perfil.md`.
2. **Coleta via `gh`**: perfil, bio, foto, repos (visibilidade, descrição, topics, README, último push, linguagem, fork, arquivado), fixados e contribuições. Vai pra `raio-x/coleta.json`.
3. **Tendências do cargo/nível**: pesquisa web curta do que recrutador e comunidade esperam ver, mais 2-3 perfis de referência.
4. **Auditoria de segurança**:
   - segredo commitado (chave, token, `.env` no histórico);
   - arquivo de produto pago ou de cliente em repo público;
   - co-autor indesejado em commit (`Co-Authored-By`, bots);
   - fork público com conteúdo sensível;
   - PR fechado guardando commit antigo.
5. **Diagnóstico com nota**: `raio-x/RELATORIO.md`, nota 0-10 por eixo (perfil, vitrine, qualidade, segurança, alinhamento).
6. **Script + plano de repos**: `raio-x/aplicar.sh` simula por padrão (`--aplicar` executa), cada passo diz como desfazer, backup `--mirror` antes de reescrever histórico. Plano dos próximos 3-5 repos.

## Regras aprendidas na prática
- O escopo `user` do `gh` abre login no navegador: avisar antes.
- Fixados não mudam pela API: a skill lista, o dev fixa na mão.
- `git push` de clone `--mirror` não aceita refspec.
- Fork público não vira privado.
- Nunca apagar repo: no máximo privado ou arquivado, e só com aval.
- Nada sai do PC do dev.

## Fora de escopo (v1)
- README de perfil com design (só sugere o texto).
- GitLab/Bitbucket.
- Organizações (só conta pessoal).

## Critérios de aceite
- [x] Roda do zero num GitHub real e entrega relatório + script sem erro.
- [x] Cada problema da reforma manual que originou a skill tem uma checagem (estudo velho público, repo de produto público, co-autor de IA, fork público, bio vazia).
- [x] Dry-run não altera nada (estado via `gh` igual antes e depois).
- [x] Nenhum caminho pessoal nos arquivos publicados.
- [ ] Passo 3 testado ao vivo com pesquisa web.

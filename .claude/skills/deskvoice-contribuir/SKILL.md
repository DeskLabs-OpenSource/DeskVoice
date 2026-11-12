---
name: deskvoice-contribuir
description: 'Caminho de quem vai mexer no código do DeskVoice e abrir um pull request, sobretudo a partir de um fork. Use SEMPRE que a pessoa disser que vai contribuir, corrigir um bug, implementar algo, abrir ou atualizar um PR, criar uma migration, resolver conflito com a main, ou perguntar "como eu testo isso", "meu ramo está atrasado?", "por que o CI ficou vermelho", "a culpa é minha?". Carregue antes de qualquer commit em clone de contribuidor. Mede ANTES do PR o que a revisão e o CI medem depois (ramo atrasado, segredo no diff, variável de ambiente nova, carimbo de migration, fragmento de versão, teste que falta) e arma os hooks de git.'
---

# Contribuir para o DeskVoice sem retrabalho

Quem contribui quase nunca erra por falta de capacidade: erra por não conhecer a régua. Este guia
aplica a régua antes do PR, do lado de quem contribui, para o PR chegar pronto.

## Como você age

- **Aconselha, não bloqueia.** Você mede e mostra. Só os hooks de git bloqueiam, e só o que é caro
  de desfazer (segredo no histórico, push na `main`, migration que vai colidir).
- **Mede na fonte.** Cada afirmação vem com o comando que a produziu e a saída que você leu. Não
  diga "passou" sem ter rodado.
- **Declara o que não mediu.** "Não rodei `pnpm test:db` porque não tenho Docker" vale mais que
  uma lista toda marcada.
- **Sabota antes de dizer "testado".** Teste que não fica vermelho quando o conserto sai não
  guarda nada.

## Passo 0: quem está contribuindo

```bash
bash .agents/skills/deskvoice-contribuir/scripts/who-am-i.sh
```

- `mantenedor: ...` (a conta do `gh` tem escrita no repositório principal): este guia fica quieto,
  a menos que a pessoa peça por nome.
- `contribuidor: ...`: siga. A saída diz o porquê e se o `origin` é o repositório principal ou um
  fork.

## Passo 1: a âncora é `origin/main`, nunca o disco

```bash
git fetch origin
B=$(git merge-base origin/main HEAD)
echo "atraso=$(git rev-list --count $B..origin/main) proprios=$(git rev-list --count $B..HEAD)"
```

- **Ramo novo** nasce de `origin/main` do repositório principal, com nome:
  `git switch -c fix/o-que-conserta origin/main`. Nunca trabalhe na `main` do fork: ela carrega o
  que é da sua instalação, e um PR aberto dali propõe tudo isso ao projeto.
- **Atraso maior que zero**: `git merge origin/main`. Nunca `reset --hard` nem `push --force`.
- Em fork, `origin` é o seu fork. Aponte um remoto para o principal e use-o como âncora:
  `git remote add upstream https://github.com/DeskLabs-OpenSource/DeskVoice.git && git fetch upstream`.
- Agente de código trabalha em worktree descartável, nunca no checkout principal:
  [`operacao-de-agentes.md`](../../../docs/doctrine/operacao-de-agentes.md).

## Passo 2: arme os hooks (uma vez por clone)

```bash
bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh
```

| Hook | Recusa | Só avisa |
|---|---|---|
| `pre-commit` | chave com formato conhecido e `.env` no commit; migration fora de `AAAAMMDDTHHMMSS_slug.sql`, com carimbo repetido, ou edição de migration já publicada | |
| `pre-push` | push direto na `main` | ramo atrasado em relação a `origin/main` |

Se o clone já tem `core.hooksPath` próprio, o script não sobrescreve. Desarmar: `--disarm`.

## Passo 3: antes de codar

1. Leia o [`AGENTS.md`](../../../AGENTS.md) da `origin/main`: as convenções críticas e os
   antipadrões. Para o porquê de uma regra, a skill `deskvoice-doutrina`.
2. Ache a issue (`gh issue list --search "<assunto>"`). Existe? Comente **"pego esta"** antes de
   codar, para ninguém fazer o mesmo trabalho. Não existe? Abra uma descrevendo o problema. Issue
   com pessoa atribuída não se duplica.
3. Vai criar uma peça? Uma ferramenta: skill `deskvoice-ferramenta`. Um motor de voz: skill
   `deskvoice-motor-de-voz`. As duas são um arquivo novo, sem editar lista nenhuma.
4. É decisão de produto (mudar uma regra para atender o seu caso)? Vira pergunta na issue, não
   código. O formato está no [`GOVERNANCE.md`](../../../GOVERNANCE.md).

## Passo 4: o pré-voo

```bash
git fetch origin
bash .agents/skills/deskvoice-contribuir/scripts/preflight.sh
```

Só mede e sai sempre com 0. Imprime, com o comando ao lado: atraso em relação à `main` e arquivos
que ela também mudou; segredo no diff; `console.log` novo; variável de ambiente fora de
`fences/env-allowlist.ts`; migration fora do padrão ou já publicada; `CHANGELOG.md` editado à
mão; fragmento presente; espelho de skills.

Depois rode o que o CI roda, inteiro, e leia o rodapé:

```bash
pnpm verify                        # lint, tipos, cercas, testes de unidade
pnpm test:db    # se tocou em banco (pede Docker; sobe e remove sozinho um Postgres descartável)
```

Cerca vermelha diz na própria mensagem o que fazer. `pnpm fences` sozinho roda em segundos.

## Passo 5: o teste, e a prova por sabotagem

Mudou comportamento? Existe um teste que fica vermelho sem a sua mudança. Se não existe, escreva,
ao lado do código (`*.test.ts`; com banco, `*.db.test.ts`).

Regras de teste deste repositório: receba um `Clock` em vez de ler a hora, abra porta `0` em vez
de porta fixa, não dependa do fuso da máquina.

Depois **commite** e sabote:

1. Desfaça só a linha do conserto (não o commit).
2. Preveja quantos testes caem, e quais.
3. Rode (`pnpm vitest run --project unit <caminho>`) e confira com a previsão.
4. Restaure: `git restore <arquivo>`.

"1 vermelho de N, o previsto" vai no corpo do PR. Sabotar antes de commitar perde trabalho.

## Passo 6: prova em tela, quando há tela

Tocou em `apps/panel`? O `pnpm verify` não abre o navegador. Suba o painel, faça o caminho de quem
usa e anexe captura ao PR, nos dois temas se mexeu em estilo. Para ter uma chamada na linha do
tempo sem tronco nem chave, use o motor simulado (`pnpm demo`).

Tocou no caminho de uma chamada? O teste de ponta a ponta é
`pnpm vitest run --project unit apps/voice`. Confira três coisas que o CI não vê: o que aconteceu
aparece na linha do tempo, a falha tem uma fala para quem ligou, e o custo foi medido.

Não conseguiu provar em tela? Diga no PR o que provou e o que ficou faltando. É o combinado.

### Os testes de tela

`apps/panel/test/e2e` guarda os caminhos de primeira impressão: entrar, configurar, simular uma
chamada, convidar alguém e as confirmações antes de apagar. O CI os roda no job `install`, contra
a instalação que ele acabou de subir. Mudou uma dessas telas? Rode-os antes do PR. Eles não sobem
nada: apontam para um painel no ar, e criam dados nele (nunca use uma instalação em uso).

Sem Docker, um painel descartável sobe assim (Postgres 17 do Homebrew; tudo numa pasta temporária;
portas e segredos são seus, inventados na hora):

1. `initdb -D <tmp>/pg -U postgres --auth=trust --no-locale`, acrescente `lc_messages = 'C'` ao
   `postgresql.conf`, suba com `pg_ctl -D <tmp>/pg -o "-p <porta> -k '' -c listen_addresses=127.0.0.1" start`
   e crie o banco com `createdb`.
2. Migrations e papéis: `MIGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/<banco>`,
   `APP_DB_PASSWORD` e `SYSTEM_DB_PASSWORD` definidas, `pnpm --filter @deskvoice/routines run migrate`.
3. As variáveis do produto: `DATABASE_URL` e `SYSTEM_DATABASE_URL` com os papéis `deskvoice_app` e
   `deskvoice_system`, `DESKVOICE_SECRET_KEY` (`openssl rand -hex 32`), `ARI_PASSWORD`,
   `INTERNAL_TOKEN`, `WAHA_API_KEY` (qualquer valor: sem ela o bloco de WhatsApp mostra outro
   estado), `PUBLIC_URL` e `VOICE_INTERNAL_URL`, `VOICE_INTERNAL_PORT`, `VOICE_WEB_PORT`,
   `AUDIOSOCKET_PORT` em portas livres e `ASTERISK_TRUNKS_FILE` na pasta temporária.
4. O dono: `printf '%s' "$DESKVOICE_E2E_PASSWORD" | pnpm --filter @deskvoice/routines run create-owner -- --email "$DESKVOICE_E2E_EMAIL" --name "Pessoa" --organization "Empresa" --password-stdin`.
5. A voz: `pnpm --filter @deskvoice/voice start` (sem Asterisk ela fica tentando a conexão, e a
   chamada simulada funciona assim mesmo).
6. O painel **construído**: `pnpm --filter ./apps/panel build`, e na pasta `apps/panel`,
   `npx next start -H 127.0.0.1 -p <porta>`. Com `next dev` as páginas recarregaram sozinhas em
   laço em 2026-11-12, e os testes falharam por isso, não pelo painel.
7. Uma vez por máquina: `pnpm --filter ./apps/panel exec playwright install --only-shell chromium`.
8. `DESKVOICE_E2E_URL=http://127.0.0.1:<porta> pnpm test:e2e`, com `DESKVOICE_E2E_EMAIL` e
   `DESKVOICE_E2E_PASSWORD` do passo 4. Falhou? O rastro de cada passo fica em
   `apps/panel/test/e2e/test-results/`: `pnpm --filter ./apps/panel exec playwright show-trace <arquivo>`.

Pare tudo ao terminar (`pg_ctl -D <tmp>/pg stop`) e apague a pasta temporária.

Teste novo de tela segue a mesma régua dos outros: seletor por papel e rótulo (`getByRole`,
`getByLabel`) com o texto importado do dicionário pt-BR, espera por estado e nunca por tempo, e
cada teste cria o que usa. E sabote: tire a confirmação, ou faça o "Salvo." aparecer sem gravar, e
veja o teste ficar vermelho.

## Passo 7: o fragmento de versão (não o CHANGELOG)

Quem opera uma instalação percebe a mudança? Escreva `.changes/<slug>.md`:

```markdown
---
impact: new_capability
section: added
title: O que muda, na voz de quem usa
---

Um parágrafo para quem opera a instalação e nunca viu o código. Crédito: @seu-usuario.
```

- `impact`: `nothing_changes` (conserto), `new_capability` (dá para fazer algo novo) ou
  `operator_action` (quem atualiza precisa fazer algo; exige um bloco `## Requer atenção`).
- `section`: `added`, `changed` ou `fixed`.
- Valide com `pnpm release:check`. Formato completo: [`.changes/README.md`](../../../.changes/README.md).
- **Nunca** edite o `CHANGELOG.md` nem escreva número de versão: ele é calculado.
- Não sabe escrever? Mande o PR sem. O fragmento que falta é trabalho dos mantenedores.

Mexeu numa skill? `pnpm skills:sync` e commite o espelho junto.

## Passo 8: abrir o PR

- **Título** no padrão Conventional Commits, em pt-BR, do ponto de vista de quem usa:
  `fix(voice): a chamada não fica muda quando o motor cai`.
- **Corpo**: o que muda para quem usa; `Closes #N`; o que você mediu (rodapé do `pnpm verify`, a
  sabotagem, a captura); e **o que não mediu**.
- Deixe "Allow edits by maintainers" ligado: é por ali que os mantenedores resolvem conflito e
  acrescentam o fragmento. Antes do seu próximo push, `git pull --no-rebase`.
- Confira a autoria: `git log --format='%an <%ae>' origin/main..HEAD | sort -u`. Commit assinado
  como `root@servidor` não aparece no seu perfil.

```bash
git push -u origin HEAD
gh pr create --repo DeskLabs-OpenSource/DeskVoice --fill
```

## Passo 9: depois do PR

O que vai parecer erro e não é, como ler um CI vermelho e o que é trabalho dos mantenedores:
[`references/depois-do-pr.md`](references/depois-do-pr.md). Os erros mais frequentes, com a
origem de cada um: [`references/erros-recorrentes.md`](references/erros-recorrentes.md).

## O que você nunca faz

- `git reset --hard`, `push --force`, `rebase` de commit já publicado.
- Editar, renomear ou apagar migration já publicada. Corrija com uma nova.
- Ligar recurso por variável de ambiente, ou pedir que alguém edite arquivo na VPS.
- Colocar chave, número de telefone real ou dado de cliente em teste, exemplo ou log.
- Fechar o próprio PR por achar que "fez ruído". PR de fork é como se contribui.

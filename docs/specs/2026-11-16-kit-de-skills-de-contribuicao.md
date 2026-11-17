# Kit de skills de contribuição: o que o DeskcommCRM tem e o DeskVoice ainda não

- **Estado:** implementado. As cinco fatias estão na `main`: fatia 1 = #318 (`ec353ad`),
  fatia 2 = #322 (`30b43b7`), fatia 3 = #372 (`4de49bb`), fatia 4 = #375 (`d0dcc7d`) e
  fatia 5 = #379 (`0210f1d`). Em `0210f1d`, `pnpm skills:sync` não
  deixa diferença e `pnpm fences` passa. O carregamento numa sessão nova do Claude Code, do Codex
  e do Cursor não foi conferido (seção 7).
- **Data:** 2026-11-16
- **Quem pediu:** o dono, no roteiro de novembro (item R9), em 13/11: "o kit de skills de
  contribuição que vai embutido no projeto, para quem clonar o projeto e quiser contribuir já vir
  com aquele carregamento automático de skill. Isso já tem no DeskcommCRM."
- **Base medida:** `origin/main` do DeskVoice em `e775a21` e do DeskcommCRM em `9dea1ee29`. As
  listas de arquivo abaixo saíram de `git ls-tree -r origin/main` nos dois, nessa data.

## 1. Problema

O DeskVoice já tem a base do kit, e este desenho não refaz nada dela: seis skills em
`.agents/skills/`, espelhadas em `.claude/skills` por `pnpm skills:sync`; o carregamento automático
(`.claude/settings.json`, `.codex/hooks.json`, `.cursor/rules/deskvoice-guias.mdc`,
`.agents/rules/deskvoice-guias.md`); e, em `deskvoice-contribuir`, o pré-voo, o `who-am-i.sh`, o
`arm-hooks.sh`, os ganchos `pre-commit`, `pre-push` e `session.sh`, e as referências
`depois-do-pr.md` e `erros-recorrentes.md`.

Comparando as duas árvores, falta isto:

| No DeskcommCRM | No DeskVoice | Destino |
|---|---|---|
| `agents/openai.yaml` em cada uma das 10 skills | nenhuma das 6 tem | fatia 1 |
| `deskcomm-contribuir/references/pre-voo.md` | o script `preflight.sh` existe; a referência que explica cada item não existe | fatia 1 |
| `deskcomm-contribuir/references/receita-e2e-local.md` | não existe | fatia 1 |
| `deskcomm-contribuir/scripts/hooks/avisar-identidade.sh`, chamado pelo `pre-commit` | não existe | fatia 1 |
| `deskcomm-contribuir/scripts/hooks/check-migration-triple.sh` | **fica de fora**: aqui não há tripla de migration, e quem cobra o nome e o carimbo é o `pre-commit` e a cerca `migrations-are-timestamped-and-unique` | — |
| `.claude/commands/triagem-de-pr.md` e os subagentes `triagem-medidor`, `triagem-reprodutor`, `triagem-cetico` | não existem | fatia 2 |
| `.claude/commands/deskcomm-gov-loop.md` e os subagentes `gov-implementer`, `gov-verifier` | não existem | fatia 3 |
| `deskcomm-metricas`, `deskcomm-prompt`, `sistema-vivo` | não existem | fatias 4 e 5 |
| `deskcomm-cliente-novo`, `deskcomm-curso`, `deskcomm-extensao`, `deskcomm-saas`, `deskcomm-operacao` | **ficam de fora**: são do produto de lá. O que serve aqui já está em `deskvoice-operar` e `deskvoice-instalar` | — |

## 2. Regras que valem para todas as fatias

1. **Adaptar, nunca colar.** Todo nome, caminho, comando, rota, evento, tabela e chave citado num
   arquivo do kit existe em `origin/main` do DeskVoice na hora do PR. O que não existe é dito como
   "ainda não existe", com a issue ou o PR que vai trazer. O autor confere com
   `git grep` contra `origin/main` e cola a conferência no corpo do PR.
2. **Nomes.** Skill nova se chama `deskvoice-<assunto>`, porque o `pnpm skills:sync` só limpa do
   espelho o que começa com `deskvoice-` (`scripts/sync-skills.ts`). Script e gancho têm nome em
   inglês (convenção 15 do `AGENTS.md`), como os vizinhos `preflight.sh` e `who-am-i.sh`.
   Referência em pt-BR, como as que existem.
3. **Espelho.** `pnpm skills:sync` depois de cada mudança em `.agents/skills/`, e
   `pnpm skills:sync --check` diz "espelho fiel" no commit do PR.
4. **Toda skill nova entra em quatro lugares na mesma mudança:** a tabela "Situação → skill" do
   `AGENTS.md`, a tabela de `.cursor/rules/deskvoice-guias.mdc`, a de `.agents/rules/deskvoice-guias.md`
   e a linha "Outras skills" do `session.sh`. As duas tabelas de regras são iguais hoje e continuam
   iguais.
5. **O gancho de início de sessão continua falando pouco**: uma vez por dia, só em clone de
   contribuidor, sem linha nova além do nome da skill na lista. Nada de mensagem nova a cada sessão.
6. **Crédito.** Cada fatia que traz texto ou estrutura do DeskcommCRM acrescenta ao `CREDITS.md`,
   na seção do DeskcommCRM que já existe, o que veio de lá e se veio como texto adaptado ou como
   lição.
7. **Documentação só.** Nenhuma fatia toca `apps/`, `packages/`, `db/`, `install/` nem
   `.github/workflows`. Se alguma precisar, para e vira pedido de decisão (seção 6).
8. **Fragmento.** Cada fatia leva `.changes/<slug>.md` com `impact: nothing_changes` (nada muda
   para quem instalou) e `section: added`, no formato de `.changes/README.md`. O texto diz que é
   para quem contribui, não para quem opera.

## 3. As fatias

### Fatia 1: o arquivo do Codex e o que falta em `deskvoice-contribuir`

**Contrato.**

- `agents/openai.yaml` em cada uma das seis skills, no formato do DeskcommCRM:
  `interface.display_name`, `interface.short_description` (uma linha, pt-BR),
  `interface.default_prompt` ("Use a skill deskvoice-… e …") e
  `policy.allow_implicit_invocation: true`. O texto sai do `description` do `SKILL.md` de cada
  uma, encurtado, sem prometer nada que a skill não faz.
- Uma cerca nova, `fences/skills-have-codex-manifest.test.ts`, com dono, motivo e data de revisão:
  toda pasta de `.agents/skills/` tem `agents/openai.yaml` que o `yaml` lê, com os quatro campos.
  Teste com fixture que reprova a skill sem o arquivo. Motivo: sem a cerca, a skill nova das fatias
  4 e 5 nasce sem o arquivo e ninguém percebe.
- `references/pre-voo.md`: cada item que o `preflight.sh` mede, por que existe, o que fazer quando
  ele acusa. Os itens saem do script **atual**, não da lista do DeskcommCRM. O `SKILL.md` aponta
  para ela no Passo 4.
- `references/receita-e2e-local.md`: subir o banco de teste (`pnpm db:test:up`), rodar
  `pnpm test:db`, `pnpm demo` e `pnpm test:e2e`, com o que cada um precisa (Docker, navegador do
  Playwright) e o que fazer quando não dá para rodar (declarar no "Não medido" do PR). Os comandos
  são os de `package.json` em `origin/main`; a receita não inventa variável de ambiente.
- `scripts/hooks/warn-identity.sh`: o mesmo comportamento do `avisar-identidade.sh` (e-mail vazio,
  `root@`, `@localhost`, `@vps*`, `@srv*`, `@*.local` → aviso em stderr; sai sempre com 0). O
  `pre-commit` chama com `|| true`. A tabela de ganchos do Passo 2 ganha a linha na coluna "Só
  avisa".

**Aceite.**

- Com o e-mail `root@vps-teste` num clone de teste, o commit sai, com o aviso; com um e-mail de
  pessoa, sai sem aviso. Prova colada no PR.
- `pnpm verify` verde; a cerca nova fica vermelha se um `openai.yaml` for apagado (sabotagem
  colada no PR).

### Fatia 2: a triagem de PR, só lendo

**Contrato.**

- `.claude/commands/deskvoice-triagem-de-pr.md`: recebe o número do PR. Lê do `origin/main` o
  `AGENTS.md`, o `CONTRIBUTING.md` e o `GOVERNANCE.md` (`git show origin/main:<arquivo>`, nunca do
  disco); baixa o PR num worktree descartável (`gh pr checkout` dentro de `git worktree add`); passa
  pelos três subagentes; e **imprime** um rascunho de parecer no formato do `GOVERNANCE.md`
  ("Parecer de revisão (sessão distinta da que escreveu)", head lido, veredito, **Não medido**).
- O comando **não publica nada**: nada de `gh pr comment`, `gh pr review`, `gh pr merge`,
  `gh pr close`, `gh pr edit`, `git push`, nem liberar CI de fork. Diz isso na primeira tela e
  manda a pessoa publicar à mão, se quiser. Achado de segurança não entra no rascunho: o comando
  aponta o caminho do `SECURITY.md`.
- Subagentes em `.claude/agents/`, com `tools: Read, Bash, Grep, Glob` (sem `Write` e sem `Edit`):
  - `deskvoice-triagem-medidor`: mede o diff contra a régua da `main`: a lista "O que o CI não vê"
    da Definition of Done, os 16 antipadrões, as regras de produto do `GOVERNANCE.md` (núcleo ou
    nicho, disparo em massa, SSH, telemetria, quem já instalou), fragmento em `.changes/`, crédito.
    Cada afirmação com comando e saída.
  - `deskvoice-triagem-reprodutor`: roda `pnpm verify` (e `pnpm test:db` se tocou em banco e houver
    Docker) no worktree; sabota o teste novo para ver se fica vermelho; nunca commita.
  - `deskvoice-triagem-cetico`: tenta derrubar o rascunho, com a tabela de recusa automática do de lá
    (sem "Não medido", pedido sem medição, presença de símbolo como prova, `grep` vazio sem controle
    positivo, código de saída lido através de pipe). Não inclui o "eixo self-host" do DeskcommCRM:
    aqui o equivalente são as regras de produto, que o medidor já lê.
- Caminho sensível (`install/`, `.github/`, `Dockerfile`, dependências, autenticação, isolamento,
  atualização): o rascunho diz "pede segunda leitura de um mantenedor", sem veredito de aprovação.

**Aceite.**

- Rodado contra um PR aberto de verdade do DeskVoice, numa sessão nova do Claude Code, imprime o
  rascunho e não deixa rastro no GitHub: `gh api repos/DeskLabs-OpenSource/DeskVoice/issues/<n>/comments`
  e a lista de reviews iguais antes e depois. A sessão colada no PR (sem segredo).
- Fracasso mesmo funcionando: o comando cita `triagem/TRIAGEM.md`, rótulo `triagem:*` ou qualquer
  arquivo do DeskcommCRM; ou publica qualquer coisa.

### Fatia 3: implementar e verificar uma fatia de desenho

**Contrato.**

- `.claude/commands/deskvoice-fatia.md`: recebe o caminho de um desenho em `docs/specs/` e o número
  da fatia. Lê o desenho e o `AGENTS.md` do `origin/main`, chama o implementador com o contrato e o
  aceite **verbatim**, depois o verificador, e repete até o verificador aprovar ou três voltas.
  Não faz `git push` e não abre PR: entrega o worktree e o relatório à pessoa.
- `.claude/agents/deskvoice-implementador.md` (com `Write` e `Edit`): uma fatia, a menor mudança,
  teste com sabotagem, fragmento, `pnpm verify`. As "regras duras" são as convenções do `AGENTS.md`
  do DeskVoice (`withOrg`, carimbo de migration, variável com padrão, texto de tela no dicionário,
  peça em arquivo próprio), **não** as do DeskcommCRM (RLS, `getUser`, tripla, `baseline.sql`).
  Ele lê a lista do `AGENTS.md` em vez de repeti-la, para não envelhecer.
- `.claude/agents/deskvoice-verificador.md` (sem `Write` e sem `Edit`): tenta derrubar a entrega
  contra o aceite do desenho e a lista "O que o CI não vê"; refaz a medição mais decisiva; devolve
  APROVADO ou REPROVADO com achados e **Não medido**.
- O que fica de fora do de lá: `loop/LOOP.md`, `features.json`, `update-feature.ts` e a "lane". O
  DeskVoice não tem esse laço, e o estado é o próprio desenho e o PR.
- Item à parte, pedido pelo board na revisão do #318 (fatia 1): o
  `deskvoice-contribuir/scripts/hooks/warn-identity.sh` passa a ler a identidade de quem assina o
  commit por `git var GIT_AUTHOR_IDENT`, não por `git config user.email`. Hoje ele dá aviso falso
  quando a pessoa passa um e-mail certo por `GIT_AUTHOR_EMAIL` ou `-c user.email=…`, e não avisa
  quando o `root@` vem do ambiente. Se o `git var` falhar (identidade desconhecida), o hook trata
  como e-mail vazio e avisa. Continua saindo sempre com 0, e o `pre-commit` continua chamando com
  `|| true`. A regra de `@vps*` não muda nesta fatia.

**Aceite.** Rodado numa sessão nova do Claude Code sobre uma fatia pequena e já entregue de um
desenho existente (a escolha fica com o Desenvolvedor, num worktree jogado fora depois), o
implementador produz a mudança, o verificador dá um veredito com "Não medido", e nada vai ao
GitHub.

Para o item do hook, a prova vai no PR, com `user.email=root@vps-teste` no `git config`:
`GIT_AUTHOR_EMAIL=pessoa@exemplo.com.br git commit` sai sem aviso; `git -c
user.email=pessoa@exemplo.com.br commit` sai sem aviso; com o `git config` de pessoa,
`GIT_AUTHOR_EMAIL=root@vps-teste git commit` sai com aviso; sem e-mail nenhum sai com aviso. Todos
com exit 0. Os casos da fatia 1 (`root@vps-teste` e e-mail de pessoa no `git config`) continuam
iguais.

### Fatia 4: as skills de doutrina e de métricas

**Contrato.**

- `deskvoice-sistema-vivo`: a lei é `docs/doctrine/sistema-vivo.md` e continua sendo. A skill é o
  procedimento de aplicá-la a uma peça nova (as perguntas da lei, em ordem, com onde conferir cada
  resposta no código) e aponta para a lei; não copia o texto dela. A `deskvoice-doutrina` ganha uma
  linha apontando para a skill.
- `deskvoice-metricas`: ler as métricas de uma instalação com régua declarada. Fonte, nesta ordem:
  as telas e rotas que já existem (`/api/v1/system/costs`, `/api/v1/calls`,
  `/api/v1/system/health`, a análise da ligação em `calls/[id]`); depois, SQL **só agregado e só
  leitura**, filtrado por `organization_id`, nunca texto de transcrição, nome ou telefone. Cada
  número com período, fuso (o da `outbound_policy`, como a rota de custos), definição e o que ficou
  de fora. Termina em ação, e a ação "a IA está respondendo mal" aponta para a skill da fatia 5.
  Não repete o que `deskvoice-operar` já ensina sobre a tela de custos: aponta para ela.
- Referências adaptadas de `deskcomm-metricas` (acesso e LGPD, consultas, régua e armadilhas),
  reescritas para as tabelas do DeskVoice. Cada consulta foi rodada contra o banco de teste
  (`pnpm db:test:up` com os dados de semente dos testes) antes do PR, e a saída vai no corpo.

**Aceite.** As duas skills aparecem no Claude Code e no Codex numa sessão nova; cada consulta da
referência roda sem erro no banco de teste; nenhuma cita tabela ou coluna que não existe.

### Fatia 5: afinar o agente de voz

**Contrato.**

- `deskvoice-agente-de-voz`: diagnosticar e corrigir "as respostas da IA estão ruins", com dados da
  operação. O que existe em `origin/main` hoje e a skill pode usar: o campo `instructions` do
  agente, a análise da ligação no fim (seção da análise em `calls/[id]`, `analysis_not_done`) e a
  linha do tempo da chamada. O que **ainda não existe** na `main` desta data e a skill diz assim:
  o campo de vocabulário na tela (PR #290, rascunho). Se o #290 entrar antes da fatia 5, a skill
  usa a tela.
- **O vocabulário, como o #379 entregou.** Ler continua valendo: a lista atual sai do
  `GET /api/v1/agents/<id>` (`data.vocabulary`), aberto pela pessoa logada no painel. **Trocar
  pela API ficou de fora**: a skill não usa `POST`/`PATCH` com a sessão de ninguém nem entrega
  código para colar no console do navegador, porque esse é o gesto do autoXSS (o golpe de colar
  código numa sessão de dono ou administrador). Até o #290 entrar, a skill só mostra a lista atual
  e a nova, recebe o sim e entrega o registro da lista aprovada (agente, data, antes, depois e o
  sim), para a pessoa aplicar quando a tela existir.
- Referências adaptadas de `deskcomm-prompt` (diagnóstico, anatomia e antipadrões de instrução),
  reescritas para voz: fala curta, sem markdown, número e e-mail ditos, a falha que tem fala
  (antipadrão 15), o vocabulário como dica que o provedor pode ignorar.
- A skill nunca troca a instrução de um agente em produção sem mostrar antes e depois à pessoa e
  pedir o sim dela; e diz como medir o efeito (análise de N ligações antes e depois), não afirma.

**Aceite.** Numa instalação de teste com agente simulado (`pnpm demo` ou a ligação simulada do
painel), a skill segue o diagnóstico de ponta a ponta sem citar campo, rota ou tela que não exista.

## 4. Critério de aceite do conjunto

O que uma pessoa consegue fazer quando terminar: clonar o DeskVoice, abrir o Claude Code, o Codex
ou o Cursor, receber a orientação curta de início (uma vez, se for contribuidor) e pedir em
português "vou abrir um PR", "triar o PR 225", "as respostas da IA estão ruins" ou "como está a
operação", e o assistente carregar a skill ou o comando certo, que só cita o que existe aqui.

Fracasso mesmo funcionando:

- skill ou comando com nome, rota, tabela ou comando do DeskcommCRM que não existe no DeskVoice;
- o gancho falando a cada sessão, ou falando para o mantenedor;
- a triagem publicando qualquer coisa no GitHub;
- uma skill nova que copia a doutrina em vez de apontar para ela (duas fontes que vão divergir);
- uma skill de métricas que leva transcrição ou telefone para o modelo.

## 5. O que fica de fora

- `.github/workflows`: nenhuma fatia toca.
- As instruções dos agentes da Paperclip: são do dono, e os subagentes do repositório não as
  substituem nem citam.
- `check-migration-triple.sh` e as skills de produto do DeskcommCRM (seção 1).
- Mudar o `session.sh` além da lista de skills.
- Um laço autônomo de construção (o `gov-loop`) no repositório.

## 6. Pedidos de decisão

Nenhum. Se uma fatia precisar tocar fora de documentação, `.claude/`, `.agents/`, `.cursor/`,
`fences/` (a cerca da fatia 1), `CREDITS.md` e `.changes/`, ela para, e o pedido vai ao lote do
Líder, com o padrão "fica de fora deste item".

## 7. Não medido

- **O carregamento do `agents/openai.yaml` pelo Codex não foi conferido**, nem na documentação do
  Codex nem numa sessão. O formato vem do DeskcommCRM, que o usa. O desenho pedia que a fatia 1
  conferisse numa sessão nova do Codex, e isso não foi feito em nenhuma das cinco fatias: segue
  aberto, como diz o estado no topo.
- Os subagentes e comandos de `.claude/` não foram rodados no DeskVoice. O formato do frontmatter
  (`tools`, `model: inherit`, `description`) vem do DeskcommCRM, não da documentação do Claude Code.
- Não li por inteiro os arquivos do DeskcommCRM que as fatias adaptam; li o começo de
  `triagem-de-pr.md`, `deskcomm-gov-loop.md`, `gov-implementer.md`, `triagem-cetico.md` e
  `deskcomm-metricas/SKILL.md`, e por inteiro só `avisar-identidade.sh` e dois `openai.yaml`.
- O Cursor não lê `agents/openai.yaml` nem `.claude/`; para ele só valem as regras e as skills.
  Não conferi se o Cursor desta data carrega `.agents/skills/` sozinho.
- Não conferi se a cerca de links (`docs-point-to-existing-files`) cobre `.claude/agents` e
  `.claude/commands`: pela leitura do código, ela lê só a raiz, `docs/` e `.agents/`. Os links
  desses arquivos ficam sem cerca, e a revisão confere.

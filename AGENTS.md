# AGENTS.md

> Autoridade para **qualquer** assistente de código neste repositório: Claude Code, Codex,
> Cursor, Antigravity ou outro. O `CLAUDE.md` só importa este arquivo. Se outro documento
> discordar deste sobre como escrever código aqui, vale este, e a divergência é um bug: abra
> uma issue.

## Visão em um parágrafo

O DeskVoice é uma central telefônica open source operada por agentes de IA, instalada na VPS de
quem usa. A ligação não é o produto, é o começo de um trabalho: um agente atende, executa
ferramentas durante a conversa, avisa ou pede aprovação a um humano, transfere quando precisa e
deixa tarefas rodando depois que a chamada termina. O projeto é 100% open source (MIT), sem
versão paga, e é irmão do DeskcommCRM. Posicionamento completo em [`VISION.md`](VISION.md).

**Consequência que muda como você trabalha:** o produto é distribuído como código, e quem
instala numa VPS é o usuário. Uma mudança que funciona na sua máquina e quebra numa instalação
nova é defeito de produto. Nada que exija editar arquivo à mão na VPS entra.

## Stack

Node 22 · TypeScript estrito · pnpm · Next.js, React e Tailwind no painel · Postgres 17 dentro
da VPS · Asterisk 20 na borda, com AudioSocket · motores de voz direta Gemini Live e OpenAI
Realtime, mais um motor simulado · `pg`, `ws`, `zod` · Vitest · ESLint · Docker Compose · Caddy.

A versão exata de cada dependência é a do `package.json`. Não afirme versão menor em prosa.

## Mapa de pastas

| Pasta | O que mora ali |
|---|---|
| `packages/core` | Conexão com o banco, executor de migrations, `withOrg`, registro de eventos, fila, cifra de segredos, telefone em E.164, configuração |
| `packages/voice-engine` | Interface `VoiceEngine`, um motor por arquivo em `src/engines/`, preço e conversão de áudio |
| `packages/tools` | Interface `Tool`, uma ferramenta por arquivo em `src/tools/` |
| `apps/voice` | Controle do Asterisk (ARI), servidor AudioSocket, ciclo de vida da chamada, política de saída, medidor de custo |
| `apps/routines` | Consumidor da fila, uma rotina por arquivo em `src/routines/` |
| `apps/panel` | Painel e API em Next.js. Dicionários de tela em `src/i18n/` |
| `db/migrations` | O único caminho de schema |
| `fences` | Cercas: testes que guardam as regras de forma |
| `deploy` | Compose, Caddy, modelos de configuração do Asterisk |
| `install` | Instalação, atualização, checagem de saúde, backup, restauração |
| `.agents/skills` | Skills embutidas. `.claude/skills` é espelho gerado, nunca editado à mão |
| `.changes` | Fragmentos de notas de versão |
| `docs/doctrine`, `docs/decisions`, `docs/guides` | Leis, decisões e guias |

O desenho e o caminho de uma ligação estão em [`ARCHITECTURE.md`](ARCHITECTURE.md). Os contratos
exatos (tabelas, interfaces, eventos, rotas, variáveis) estão em
[`docs/plans/2026-11-10-fundacao.md`](docs/plans/2026-11-10-fundacao.md), seção "Contratos
compartilhados". Mudou um contrato? Mude lá primeiro.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm verify` | Lint, tipos, cercas e testes. Rode antes de abrir PR |
| `pnpm test` | Testes de unidade |
| `pnpm test:db` | Testes que usam Postgres real. Pede Docker |
| `pnpm fences` | Só as cercas. É o que mais reprova PR, e é rápido |
| `pnpm typecheck` | Tipos |
| `pnpm lint` | ESLint |
| `pnpm skills:sync` | Regenera o espelho `.claude/skills` a partir de `.agents/skills` |
| `pnpm demo` | Roda uma chamada inteira com o motor simulado, sem chave nem tronco |

## Convenções críticas

São as regras de forma do desenho da fundação. Cada uma tem uma cerca ou um teste que a cobra.

1. **Um caminho de schema.** Mudança de banco é um arquivo novo em `db/migrations`, com nome
   `<AAAAMMDDTHHMMSS>_<slug>.sql`. Só para frente. Migration publicada nunca é editada. Não
   existe baseline. Lei: [`um-caminho-de-schema.md`](docs/doctrine/um-caminho-de-schema.md).
2. **Um arquivo por peça.** Ferramenta, motor de voz, rotina e dicionário de tela são
   descobertos por pasta. Se o seu PR precisa editar uma lista central para registrar uma peça,
   pare: a lista não deveria existir. Lei: [`um-arquivo-por-peca.md`](docs/doctrine/um-arquivo-por-peca.md).
3. **Toda tabela tem `organization_id uuid not null`**, exceto `organizations` e
   `schema_migrations`.
4. **Todo acesso a dado de produto passa por `withOrg`.** SQL cru fora de `packages/core` é
   reprovado. Lei: [`isolamento.md`](docs/doctrine/isolamento.md).
5. **Um ponto de escrita por entidade.** Evento de chamada se grava com `recordEvent`. Tarefa
   se enfileira com `enqueueTask`. Não escreva nessas tabelas por outro caminho.
6. **Fila por notificação.** Quem consome tarefa acorda por `listenTasks` e reivindica com
   `claimTask`. Sem polling de intervalo curto.
7. **Configuração de operador tem tela.** Nenhuma variável de ambiente nova sem valor padrão ou
   sem ser gerada pelo instalador. Recurso que se liga por `.env` não entra.
8. **Tudo tem log.** O que acontece numa chamada vira `call_events`, com um tipo do vocabulário
   fechado em `packages/core`. Tipo novo entra no vocabulário, não como texto solto.
9. **Nenhum texto visível fora de dicionário.** Frase de tela mora em `apps/panel/src/i18n/`,
   em pt-BR, inglês e espanhol.
10. **Teste não usa relógio real, porta fixa nem fuso da máquina.** Receba um `Clock` e abra
    porta `0`. Código de produto não chama `new Date()` direto.
11. **Sem `any`, sem `@ts-ignore`, sem `catch` vazio.**
12. **Segredo de operador é cifrado em repouso** (senha de tronco, chave de IA), com
    `encryptSecret`. Nunca em texto puro no banco, em log ou em evento.
13. **Telefone se compara em E.164.** Normalize com `toE164` antes de gravar ou de consultar a
    lista de não ligar.
14. **Ligações de saída nascem desligadas** e passam por `checkOutboundAllowed`. Não crie
    caminho que origine chamada sem essa checagem. Lei: [`ligacoes-de-saida.md`](docs/doctrine/ligacoes-de-saida.md).
15. **Identificadores em inglês, documentação e tela em pt-BR como origem.** Commits em pt-BR,
    no padrão Conventional Commits.
16. **Entrada externa é validada com zod**: corpo de rota, argumento de ferramenta vindo do
    modelo, resposta de provedor.

## Antipadrões

Cada item nasceu de um erro medido no DeskcommCRM. O motivo está escrito para você reconhecer a
situação, e não só a regra.

| Nº | Não faça | O erro que originou a regra |
|---|---|---|
| 1 | Numerar migration em sequência, ou registrar uma peça num arquivo-índice | No Deskcomm, PRs paralelos colidiam no mesmo número e na mesma lista. Aqui: carimbo de tempo, um arquivo por peça e fila de merge |
| 2 | Manter um segundo retrato do schema (baseline) ao lado das migrations | Baseline e migrations divergiram, e a instalação nova recebia um banco diferente do de quem atualizava. Aqui: um caminho só, com teste de atualização a partir da última versão |
| 3 | Escrever teste que depende de hora real, porta fixa, fuso ou estado acumulado do repositório | PR bom ficava vermelho por causa alheia. Aqui: check de PR só mede o diff, e estado acumulado é check da `main` |
| 4 | Consultar o banco sem a camada de organização, ou filtrar `organization_id` à mão | O isolamento entre empresas foi furado em caminhos que esqueciam o filtro. Aqui: `withOrg` é a única porta, e o teste de isolamento é gerado para toda tabela |
| 5 | Ligar recurso por variável de ambiente ou por arquivo editado na VPS | No Deskcomm, conectar o tronco exigia editar arquivo por SSH. Aqui: configuração pela tela, e uma cerca reprova variável sem padrão |
| 6 | Depender de serviço de nuvem para o sistema subir, ou consultar fila em laço curto | Cota e lentidão do banco na nuvem foram a reclamação operacional mais repetida. Aqui: Postgres na VPS e fila por notificação |
| 7 | Dizer "sucesso" sem conferir | Backup e restauração diziam "sucesso" sem comparar nada. Aqui: a restauração confere contagens, e a checagem de saúde nunca resume tudo em um "ok" |
| 8 | Mudar o atualizador sem rodá-lo contra um banco com dados | O atualizador do Deskcomm nunca era testado. Aqui: a atualização roda no CI |
| 9 | Trabalhar no checkout principal, ou rodar comando destrutivo com caminho relativo | Um agente apagou o checkout principal. Aqui: worktree descartável e caminho absoluto conferido. Lei: [`operacao-de-agentes.md`](docs/doctrine/operacao-de-agentes.md) |
| 10 | Colocar segredo ou dado pessoal real no repositório, em teste, exemplo ou log | Já aconteceu. Aqui: varredura de segredo no CI e no hook desde o primeiro commit. Use dados inventados |
| 11 | Criar cerca, trava ou exceção sem dono, motivo e data de revisão | Travas sobreviviam ao motivo que as criou. Lei: [`cercas.md`](docs/doctrine/cercas.md) |
| 12 | Trazer código de outro projeto sem dizer de onde veio | Código de terceiros entrou sem crédito. Aqui: [`CREDITS.md`](CREDITS.md) na mesma mudança |
| 13 | Deixar uma decisão de produto esperando o dono sem dizer o que vale se ele não responder | O dono virou gargalo. Aqui: [`GOVERNANCE.md`](GOVERNANCE.md) tem regras de produto, e todo pedido de decisão traz o padrão |
| 14 | Entregar capacidade que não devolve resultado ao resto do sistema | O agente de voz do Deskcomm não devolvia o desfecho da ligação, e a ligação não entrava no limite de gasto. Aqui: toda peça tem duas conexões e todo custo é medido. Lei: [`sistema-vivo.md`](docs/doctrine/sistema-vivo.md) |

Dois antipadrões não vêm de erro do Deskcomm. Vêm dos antiobjetivos da fundação, e valem igual:

| Nº | Não faça | Por quê |
|---|---|---|
| 15 | Deixar a chamada muda quando algo falha | Quem ligou não tem tela para ver o erro. Toda falha tem uma fala para quem está na linha e um evento para o painel |
| 16 | Facilitar disparo em massa: importar lista para discagem, afrouxar teto, contornar a lista de não ligar | Bloqueia a linha de quem usa e prejudica quem recebe. Não entra, com qualquer justificativa |

## Situação → skill

As skills moram em `.agents/skills/`. Peça o assunto em português e o seu assistente carrega a
certa. Ou chame pelo nome.

| Situação | Skill |
|---|---|
| Vou abrir um PR, ou o CI ficou vermelho e não sei se a culpa é minha | `deskvoice-contribuir` |
| Não sei se algo é permitido, ou quero o porquê de uma regra | `deskvoice-doutrina` |
| Vou instalar numa VPS, ou a instalação falhou | `deskvoice-instalar` |
| Vou criar ou alterar uma ferramenta que o agente usa na chamada | `deskvoice-ferramenta` |
| Vou adicionar ou alterar um motor de voz | `deskvoice-motor-de-voz` |
| Tenho uma instalação rodando e preciso atualizar, fazer backup, diagnosticar | `deskvoice-operar` |

Editou uma skill? Rode `pnpm skills:sync`. O espelho fora de sincronia reprova no CI.

## Definition of Done

A lista está dividida em duas de propósito. Misturar o que a máquina reprova com o que só uma
pessoa percebe faz o contribuidor marcar tudo de boa-fé e ser barrado por algo que ninguém
contou a ele.

### O que o CI reprova

Rode `pnpm verify` e, se tocou em banco, `pnpm test:db`. Isso cobre:

- lint, tipos e testes de unidade;
- tabela sem `organization_id`;
- migration fora do padrão de nome ou com carimbo repetido;
- variável de ambiente sem padrão;
- SQL cru fora de `packages/core`;
- texto de tela fora de dicionário;
- marcador de conflito esquecido;
- workflow sem permissões declaradas;
- espelho de skills fora de sincronia;
- documento apontando para arquivo que não existe;
- cerca sem dono, motivo ou data de revisão;
- fragmento de versão inválido;
- instalação nova e atualização a partir da última versão;
- a chamada simulada de ponta a ponta;
- construção das imagens e o instalador;
- segredo no diff.

### O que o CI não vê

Fica com você e com a revisão. É onde moram os defeitos caros.

- **A peça tem duas conexões?** O que a alimenta e o que ela alimenta. Capacidade que ninguém
  chama não entra.
- **O que aconteceu aparece na linha do tempo?** Evento gravado e legível na tela.
- **Se falhar, quem ligou ouve o quê? E a tela mostra o quê?** Nenhum caminho de erro termina em
  silêncio.
- **Tem tela?** Se o operador precisa de SSH para usar, não está pronto.
- **O custo é medido e respeita o teto?** Vale para qualquer coisa que gaste com provedor.
- **A descrição da ferramenta foi escrita para o modelo?** Ela diz quando usar e quando não usar.
- **A ação destrutiva pede confirmação nomeando o alvo?** Lei: [`destrutivo-pede-confirmacao.md`](docs/doctrine/destrutivo-pede-confirmacao.md).
- **É código de nicho?** Regra de um ramo de negócio não entra no núcleo.
- **O texto está no tom?** Profissional e calmo, sem exclamação, sem adjetivo vazio.
- **Quem já instalou precisa fazer alguma coisa?** Se sim, diga no PR. Lei: [`versionamento.md`](docs/doctrine/versionamento.md).
- **Trouxe algo de fora?** Crédito em [`CREDITS.md`](CREDITS.md).
- **Outra pessoa verificou?** Quem implementa não é quem verifica.

## Regra final: não invente

- **Não invente capacidade.** Se o contrato não está no plano nem no código, ele não existe.
  Nome de função, rota, evento ou tabela se confere no arquivo, não na memória.
- **Não invente estado.** "Funciona", "passou" e "corrigido" só depois de rodar e ler a saída.
- **Não invente decisão.** O que é do dono do projeto está em [`GOVERNANCE.md`](GOVERNANCE.md).
  Faltou regra? Escreva um pedido de decisão no formato de lá, com o padrão que vale sem
  resposta, e siga com o que não depende dela.
- **Não invente fato externo.** Preço de provedor, regra da Anatel e comportamento de operadora
  mudam. Cite a fonte e a data, ou diga que não conferiu.
- **Na dúvida entre dois caminhos, escolha o menor** e diga no PR o que ficou de fora.

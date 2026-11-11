# Conformidade do DeskVoice com a Fábrica DeskLabs

- **Data da medição:** 2026-11-11
- **Commit medido:** `f018499` (ramo `develop`). A árvore é idêntica à da `main` em `fb50506` (`git diff --stat fb50506 f018499` vazio), cujo CI passou.
- **Régua:** Fábrica DeskLabs no commit `30797dc` (`conformidade.md`, 154 itens).
- **Quem mediu:** um agente auditor, sem ter escrito o código. Nada foi corrigido.

## Como foi medido

- Item de arquivo e de leitura: o arquivo foi aberto nesta sessão. A evidência cita caminho e linha.
- Item de comando: o comando rodou nesta sessão.
- Item de execução: o sistema **não** foi subido (sem Docker, sem chave de provedor). Usei o que roda sem isso:
  - `bash install/test/run.sh`: 10 arquivos, 424 verificações, 0 falhas (Docker simulado);
  - `bash install/install.sh --dry-run --yes` com respostas de exemplo: saiu com 0 e não criou arquivo;
  - `bash -n` em todos os scripts de `install/`: sem erro de sintaxe;
  - leitura dos testes que cobrem o comportamento. Os testes de banco (`*.db.test.ts`) e as cercas não rodaram aqui (a cópia de trabalho não tem dependências instaladas). Para eles a evidência é o teste lido mais o CI da `main` verde nesse mesmo conteúdo (execução `ci push main success fb50506`, consultada com `gh run list`).
- GitHub foi consultado só para leitura (`gh api`, `gh pr list`, `gh run list`).
- Fatos externos informados pelo dono e usados como evidência: uma instalação real em 11/11/2026 numa VPS de teste do parceiro, pelo comando de uma linha, sem perguntas, numa máquina compartilhada; uma conversa por voz com motor real por um cliente de teste (não por navegador); nenhuma ligação por operadora; fila de merge e acolhida nunca exercitadas; nenhuma versão publicada.

## Contagem

| Resultado | Nível F | Nível C | Total |
|---|---|---|---|
| Conforme | 81 | 1 | 82 |
| Não conforme | 57 | 0 | 57 |
| Não se aplica | 0 | 11 | 11 |
| Decidido diferente | 0 | 0 | 0 |
| Não medido | 4 | 0 | 4 |
| **Total** | **142** | **12** | **154** |

Nenhum item ficou como "decidido diferente": nenhuma das divergências medidas tem registro de decisão em `docs/decisions/`. Três delas estão escritas como limite conhecido (6.7 em `SECURITY.md:79`, a falta de checagem de `/voice-ws` em `docs/decisions/0008-chamada-pelo-navegador.md:34`, e a construção na VPS em avisos do instalador), o que não é registro de decisão com alternativas e custo.

Os quatro "não medido" (8.8, 8.9, 11.1, 11.3) pedem o sistema rodando numa instalação nova ou num servidor recém-criado.

## Itens F não conformes, em ordem de dano

### 1. Pode causar prejuízo a quem instala ou usa

| Ordem | Item | Defeito, em uma linha |
|---|---|---|
| 1 | 6.7 | Quem sabe o e-mail do dono erra a senha cinco vezes e o tranca fora do painel por 15 minutos, quantas vezes quiser |
| 2 | 8.5 | Um clique remove um número da lista de não ligar, sem confirmação. O mesmo vale para a chave de IA, o conector de WhatsApp e um webhook |
| 3 | 8.6 | Não há tela de equipe, convite nem troca de senha: a equipe divide a conta do dono (em correção no ramo `feat/equipe-e-convites`) |
| 4 | 2.16 | Ligação recebida pela operadora não tem teto somado: o gasto com IA é limitado só por chamada, e não por período nem por chamadas simultâneas |
| 5 | 11.16 | O instalador termina sem conferir que a tela de entrada aceita o usuário criado |
| 6 | 11.5 | O instalador diz "pronto" e mostra o endereço sem conferir que ele abre de fora: a sonda roda dentro dos contêineres |
| 7 | 11.6 | A saúde não tem linha para proxy → painel, proxy → `/voice-ws`, painel → banco nem rotinas → banco |
| 8 | 8.4 | A saúde da tela não mostra o processo de rotinas: com ele parado, resumos, avisos e expiração de aprovação param e a tela diz que está tudo bem |
| 9 | 12.3 | A instalação grava `stable` como versão: duas instalações "iguais" rodam imagens diferentes e nenhuma sabe qual |
| 10 | 12.2 | Sem imagem publicada, o instalador e o atualizador constroem na VPS, com aviso, em vez de parar com erro |
| 11 | 12.4 | Nome da imagem e formato da versão estão em três arquivos; o desencontro foi contornado publicando duas etiquetas |
| 12 | 3.3 | `postgres:17-alpine` e `caddy:2-alpine` são etiquetas móveis: a instalação de amanhã baixa outra versão sem nada ter mudado no repositório |
| 13 | 11.19 | O kit não confere de que pasta a instalação foi feita: um segundo clone roda o instalador sobre o mesmo projeto do Compose |
| 14 | 11.12 | Nenhuma rota mostra a versão em execução: quem dá suporte não sabe o que está rodando |
| 15 | 9.8 | Não está escrito por quanto tempo transcrições ficam guardadas nem existe rotina que as apague |
| 16 | 7.8 | A rota pública de saúde soma linhas e chaves de todas as organizações: com duas, uma vê o estado da outra em número |
| 17 | 8.10 | Só a linha telefônica tem teste de conexão. Chave de IA errada só aparece na primeira ligação; conector de WhatsApp e webhook, no primeiro envio |
| 18 | 11.13 | Uma instalação real só, na VPS do parceiro. Nenhuma em outro provedor |
| 19 | 13.5 | O repositório foi publicado antes da instalação real: o defeito que ela achou ficou público até o PR #3 |

### 2. Afirma mais do que faz

| Ordem | Item | Defeito, em uma linha |
|---|---|---|
| 20 | 10.5 | `GOVERNANCE.md` diz que ninguém aprova o próprio PR e que tudo passa pela fila de merge; os PRs #2, #3 e #4 foram mesclados pelo autor, sem revisão, por passagem de administrador |
| 21 | 5.10 | Três documentos dizem que a cerca reprova SQL fora de `packages/core`; ela só reprova `import pg` e `.query(`, e 49 arquivos fora do núcleo escrevem SQL |
| 22 | 5.18 | Afirmações "o CI prova" sem job: atualização a partir da última versão (o passo é pulado), "teste da tela" de confirmação (não existe teste de tela) |
| 23 | 1.7 | O README não lista "falar com o agente pelo navegador" e ainda diz que instalação em VPS e motores reais aguardam prova |
| 24 | 11.17 | O README não diz em que ambientes a instalação foi provada nem o que fazer nos outros |
| 25 | 9.1 | A doutrina de ação destrutiva diz que é cobrada "no teste da tela"; a doutrina de sistema vivo não traz o caso de origem |
| 26 | 5.2 | `AGENTS.md` diz que cada convenção tem cerca ou teste; 13 das 16 convenções não apontam para nenhum |
| 27 | 2.4 | A linha do parceiro no fim do instalador traz o link sem dizer que é de parceria |
| 28 | 12.10 | O desenho declara documentação em três idiomas; só o README está nos três |

### 3. Cercas e jobs que faltam

| Ordem | Item | Defeito, em uma linha |
|---|---|---|
| 29 | 5.16 | O CI constrói as três imagens e não sobe nenhuma: um processo que quebra na partida passa |
| 30 | 12.1 | Não existe a cerca que reprova serviço de produção sem imagem publicada |
| 31 | 8.3 | Não há teste que amarre as telas ao menu; `/calls/talk` não está no menu |
| 32 | 4.2 | Não há cerca para as proibições visuais (biblioteca, fonte, cor fora de token) |
| 33 | 4.5 | As fontes são baixadas do Google na construção: sem rede para esse serviço, a imagem do painel não constrói |
| 34 | 5.13 | O job `changes` não tem o passo que diz de quem é a causa |
| 35 | 5.19 | Um teste compara com o relógio real (`queue.db.test.ts:63`) |

### 4. Documentos que faltam

| Ordem | Item | Defeito, em uma linha |
|---|---|---|
| 36 | 6.1 | Não há tabela de decisões de autenticação, nem o que não existe |
| 37 | 6.9 | "Limites conhecidos" não diz que faltam segundo fator, token de API, convite, troca de senha pela tela e recuperação por e-mail |
| 38 | 8.1 | Não há inventário do que o operador configura pela tela e do que fica no servidor |
| 39 | 8.11 | O nível de cada configuração (instalação, organização, agente) não está escrito |
| 40 | 2.12 | O guia do implementador não trata de contrato, capacidade da máquina, acesso do cliente nem a quem recorrer |
| 41 | 2.13 | O guia de custos traz o método e nenhuma estimativa mensal do caminho recomendado |
| 42 | 3.4 | Memória e disco do sistema parado não foram registrados |
| 43 | 3.1 | Painel, proxy, empacotamento, monorepo e autenticação própria não têm registro de decisão com alternativas e custo |
| 44 | 4.1 | Não há documento de design system |
| 45 | 4.7 | Não há registro de que o dono validou a direção visual |
| 46 | 1.4 | Os antiobjetivos da visão não apontam para o teste, a cerca ou o item de revisão que os guarda |
| 47 | 9.2 | A adoção do sistema vivo não nomeia o gate mecânico nem o par de medidas |
| 48 | 9.3 | Três invariantes do manual ficaram de fora sem motivo escrito |
| 49 | 9.9 | A doutrina de agentes de código se chama `operacao-de-agentes.md`; não há doutrina de empacotamento nem de prova em par |
| 50 | 10.3 | As regras de produto 4, 5 e 6 não trazem o porquê |
| 51 | 12.11 | Nada no processo de versão manda conferir os guias |
| 52 | 13.2 | A tabela de erros do desenho tem 14 linhas; `licoes.md` tem 13 grupos e 102 lições |
| 53 | 13.3 | O parecer da revisão fria não está guardado |
| 54 | 13.4 | Não há lista dos bloqueadores da revisão fria com a mudança que fechou cada um |
| 55 | 13.7 | Não há registro de um caminho de ponta a ponta pelas entradas reais |
| 56 | 13.8 | No commit medido não havia o registro do uso pelo dono (criado por esta auditoria, sem commit) |
| 57 | 13.9 | No commit medido não havia a lista do que nunca foi exercitado (criada por esta auditoria, sem commit) |

---

## 1. Visão

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 1.1 | `VISION.md` com tese, nome, crenças, públicos, modelo, antiobjetivos, como falamos e norte | Conforme | `VISION.md:7` (tese), `:20` (nome), `:58` (crenças), `:75` (públicos), `:85` (modelo), `:107` (fracasso), `:117` (como falamos), `:128` (norte) | — |
| 1.2 | A tese fala do resultado | Conforme | `VISION.md:9`: "A ligação não é o produto. É o começo de um trabalho." | — |
| 1.3 | Cada parte da palavra central aponta para uma peça | Conforme | `VISION.md:33-38`: tabela com quatro partes, nenhuma sem peça | — |
| 1.4 | Cada antiobjetivo aponta para o que o guarda | Não conforme | `VISION.md:109-115` e `docs/specs/2026-11-10-fundacao-design.md:59-65` listam os cinco sem apontar teste, cerca ou item de revisão. Efeito: quem revisa não sabe onde conferir | Acrescentar uma coluna à lista: `call-session.db.test.ts` (`engine_failed`), cerca `env-vars-have-defaults`, `install/test/07-healthcheck.sh`, teste de teto de custo, `outbound-policy.db.test.ts` e regra 3 da governança |
| 1.5 | Três tipos de "não" separados | Conforme | Fora da fundação: `docs/specs/2026-11-10-fundacao-design.md:48-55`. Fora do horizonte: `ROADMAP.md:45-48`. Para sempre: `GOVERNANCE.md:50-58`, e `ROADMAP.md:49-50` diz "Não é adiamento. É regra de produto" | — |
| 1.6 | Registro da fronteira com cada irmão | Conforme | `docs/decisions/0001-fronteira-com-o-deskcomm.md` | — |
| 1.7 | O README declara, por capacidade, até onde foi provada | Não conforme | A tabela existe (`README.md:94-107`). Faltam nela: "falar com o agente pelo navegador" (busca por "navegador" nos três READMEs: nenhuma ocorrência; a capacidade entrou no PR #4). Linhas atrasadas: `README.md:106` ("instalação em VPS aguardando prova real") e `:104` (motores reais só contra servidor falso). Efeito: quem lê não sabe que a chamada pelo navegador nunca rodou num navegador | Acrescentar a linha da chamada pelo navegador (provada com cliente de teste e motor real, não com navegador) e atualizar as duas linhas, nos três idiomas |

## 2. Modelo de negócio

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 2.1 | Parceiro nomeado na visão e num bloco do README antes do comando | Conforme | `VISION.md:90`; `README.md:29-36`, antes do comando em `:43` | — |
| 2.2 | O bloco diz que outra VPS funciona igual; link identificado como de parceria | Conforme | `README.md:33` ("pelo link da parceria") e `:35-36` | — |
| 2.3 | Nenhuma pasta, arquivo ou variável com o nome do parceiro | Conforme | `git ls-files \| grep -i hostgator`: vazio (a mesma busca com "install" acha 27 arquivos). Busca por variável com o nome: só texto em `install/install.sh:389` e o caso de teste em `install/test/03-network.sh:37` | — |
| 2.4 | O texto da oferta tem uma redação só | Não conforme | Dez ocorrências do link. Nove dizem parceria. `install/install.sh:389` diz "VPS recomendada pelo projeto, se um dia for trocar" e traz o link sem dizer que é de parceria. Efeito: o link aparece sem dizer o que é | Trocar o texto da linha 389 por "parceira do projeto (link de parceria)" |
| 2.5 | O instalador só menciona o parceiro sob condição testada | Conforme | `install/_common.sh:295-300` (`partner_hint_allowed`); `install/test/03-network.sh:33-37`; rodou: 23 verificações, 0 falhas | — |
| 2.6 | "Caminho genérico nunca sabotado" e "sem recurso pago" são regras de produto | Conforme | `GOVERNANCE.md:66-74` (regras 5 e 6) | — |
| 2.7 | Telemetria: nenhuma | Conforme | `VISION.md:94`; `GOVERNANCE.md:68-69`; `Dockerfile:35,40` (`NEXT_TELEMETRY_DISABLED=1`). Observação: o instalador consulta três serviços externos para descobrir o IP público (`install/_common.sh:385`); não envia dado de uso | — |
| 2.8 | Guia de custos | Conforme | `docs/guides/custos.md` (contas `:10-16`, estimar `:54-70`, medir `:72-80`, limitar `:82-96`) | — |
| 2.9 | Guia do implementador | Conforme | `docs/guides/ganhar-dinheiro-implementando.md` | — |
| 2.10 | Custo de provedor aparece na tela e respeita teto do operador | Conforme | Medição e teto: `apps/voice/src/call-session.ts:186-213`; teste `apps/voice/src/call-session.db.test.ts:355` (evento `cost_ceiling_reached`); soma por período: `apps/panel/src/app/api/v1/system/costs/route.ts`, teste `rules.db.test.ts:548`; padrão do teto em `db/migrations/20261110T230000_foundation.sql:100` (500 centavos). CI da `main` verde. Limite da medição: só o custo de IA; o de telefonia não é medido (dito em `docs/guides/custos.md:80`). Não vi a tela com motor real | — |
| 2.16 | Todo caminho que gasta tem teto somado | Não conforme | Navegador: 3 simultâneas por organização (`apps/voice/src/web-calls.ts:29,90`). Saída: teto diário por linha (`outbound-policy.db.test.ts:93`). Entrada pela operadora: `apps/voice/src/inbound.ts:40-64` só recusa por agente ausente ou desligado; não há teto por período nem de simultâneas (busca por "concurr", "simult", "limit" no arquivo: nada). Efeito: muitas ligações ao mesmo tempo gastam o teto por chamada vezes o número de ligações | Um teto de chamadas recebidas simultâneas por organização, ajustável pela tela, com recusa registrada na linha do tempo |
| 2.11 | Marca própria em tempo de execução | Não se aplica | Não há revenda com marca | — |
| 2.12 | O guia do implementador responde as sete perguntas | Não conforme | Responde: quanto cobrar (`:60-113`), quem paga (`:89-102`), prever gasto (`:101-102` e `custos.md:54-70`). Não responde: contrato (só "defina por escrito", `:86`), capacidade da máquina, acesso do cliente, a quem recorrer | Quatro seções curtas no guia, uma por pergunta que falta |
| 2.13 | Custo mensal do caminho recomendado estimado, com método e limites gratuitos | Não conforme | `docs/guides/custos.md:56-60` traz o método; `:105-107` diz que não publica valores. Não há estimativa nem menção a limite gratuito | Uma estimativa com data (VPS + um cenário de ligações por mês) e uma linha sobre o limite gratuito de cada provedor |
| 2.15 | Custo mensal medido em uso real | Não se aplica | Condição: depois do primeiro uso real. Não houve uso em produção nem ligação por operadora | — |
| 2.14 | Caso real documentado | Não se aplica | Mesma condição de 2.15 | — |

## 3. Stack

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 3.1 | Cada escolha estrutural com registro de decisão | Não conforme | Há registro para telefonia e linguagem (`0002`), banco e fila (`0003`), schema (`0005`), organização (`0006`). Painel (Next.js), proxy (Caddy), empacotamento, monorepo e autenticação própria estão só como uma linha em `docs/specs/2026-11-10-fundacao-design.md:142-153`, sem alternativas nem custo | Um registro curto por escolha que falta, ou um só registro "stack do painel e do empacotamento" |
| 3.2 | O sistema sobe sem conta em serviço de terceiros | Conforme | `install/_common.sh:101-128`: todo valor é gerado, nenhuma credencial de terceiros. Instalação real de 11/11 feita sem chave de provedor (fato informado pelo dono; PR #3). Observação: foi numa máquina compartilhada, não numa instalação limpa | — |
| 3.3 | Dependências de terceiros com versão fixa | Não conforme | `deploy/docker-compose.yml:24` (`postgres:17-alpine`) e `:117` (`caddy:2-alpine`) são etiquetas móveis. Asterisk está fixo por resumo (`:91`). Efeito: instalações de dias diferentes rodam versões diferentes | Fixar as duas imagens por versão exata ou por resumo, como já é feito com o Asterisk |
| 3.4 | Memória e disco do sistema parado registrados | Não conforme | Não há registro no repositório, e os números não foram medidos. Efeito: ninguém sabe se cabe na menor VPS do parceiro | Medir na VPS da instalação real (`docker stats`, `df`) e escrever em `docs/fundacao/instalacao-real.md` |
| 3.5 | A peça de maior risco rodou antes | Conforme | `docs/decisions/0002-asterisk-e-audiosocket.md:31`: a ponte AudioSocket veio do DeskcommCRM; crédito em `CREDITS.md:15-16` | — |

## 4. Design system

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 4.1 | Documento de design system | Não conforme | Não existe. Há só `apps/panel/src/design/tokens.css` e uma linha em `docs/specs/2026-11-10-fundacao-design.md:150-151` | Um documento com a direção e as proibições, cada uma com o motivo |
| 4.2 | Cada proibição mecânica tem cerca | Não conforme | Nenhuma das 15 cercas trata de biblioteca, fonte ou cor. O que existe é configuração: `apps/panel/src/app/globals.css:6` remove a paleta padrão | Uma cerca que reprove valor de cor literal em `.tsx` |
| 4.3 | Componentes usam só token semântico | Conforme | Busca por `#hex`, `rgb(`, `hsl(`, `oklch(` em `.ts` e `.tsx` do painel: nenhuma ocorrência. A mesma busca em `tokens.css` acha 17 linhas | — |
| 4.4 | Uma fonte só de tokens | Conforme | `apps/panel/src/design/tokens.css`; `globals.css:5-33` só faz a ponte | — |
| 4.5 | Fontes versionadas; a construção não baixa de fora | Não conforme | `apps/panel/src/app/layout.tsx:2,9-10` usa `next/font/google`. Nenhum arquivo de fonte no repositório. Efeito: a construção depende de um serviço externo | Versionar os arquivos das duas fontes e trocar para `next/font/local` |
| 4.6 | Texto de tela só em dicionário, nos idiomas declarados | Conforme | Cerca `fences/ui-text-lives-in-dictionaries.test.ts`; os dicionários `en` e `es` são tipados pelo `pt-BR` (`apps/panel/src/i18n/en/login.ts:1-3`), então chave faltando reprova no `typecheck` | — |
| 4.7 | O dono validou a direção | Não conforme | Nenhum registro. O desenho marca a identidade visual como decisão do construtor (`:150`) | Uma linha datada do dono no documento de design system |

## 5. Engenharia

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 5.1 | Um documento de autoridade; os outros só o importam | Conforme | `AGENTS.md:3-6`; `CLAUDE.md:1` (`@AGENTS.md`). `.cursor/rules/deskvoice-guias.mdc` repete só a tabela de skills, conferida pela cerca `skills-mirror-is-in-sync` | — |
| 5.2 | Cada convenção aponta para o que a cobra | Não conforme | `AGENTS.md:66` afirma que cada uma tem cerca ou teste. Só as convenções 4, 7 (parcial) e as que citam doutrina apontam para algo; 5, 6, 8, 9, 10, 11, 12, 13, 15 e 16 não nomeiam cerca, teste nem "cobrada na revisão" | Uma coluna "quem cobra" na lista, com o caminho ou a palavra "revisão" |
| 5.3 | Cada antipadrão traz o erro de origem | Conforme | `AGENTS.md:108-130`: 16 linhas, todas com o erro ou o porquê | — |
| 5.4 | Definição de pronto em duas listas | Conforme | `AGENTS.md:154-192` | — |
| 5.5 | Um caminho de schema; carimbo de tempo | Conforme | Cerca `fences/migrations-are-timestamped-and-unique.test.ts`; o único `.sql` versionado fora de fixtures é `db/migrations/20261110T230000_foundation.sql` | — |
| 5.6 | Um arquivo por peça | Conforme | `fences/one-file-per-piece.test.ts` (ferramentas, motores, rotinas). Dicionários não entram na cerca; cada tela importa os três da própria área (`apps/panel/src/i18n/provider.tsx:14-22`) | — |
| 5.7 | Fila por notificação; nada se reenfileira para esperar | Conforme | `apps/routines/src/runner.ts:122` (`listenTasks`), `:85-91` (arma o temporizador para o próximo `run_at`). Nenhuma rotina chama `enqueueTask` (busca nas cinco rotinas) | — |
| 5.8 | Nenhuma variável de ambiente sem padrão | Conforme | `fences/env-vars-have-defaults.test.ts` e `fences/env-allowlist.ts` | — |
| 5.9 | Toda cerca com dono, motivo e data | Conforme | `fences/fences-have-owner-and-review-date.test.ts`; os 15 arquivos abrem com os três campos | — |
| 5.10 | Cada cerca guarda o que o texto diz | Não conforme | `fences/no-raw-sql-outside-core.test.ts:8-9` reprova `import pg` e `.query(`. Os textos dizem mais: `docs/doctrine/isolamento.md:38` ("Não se escreve SQL fora de `packages/core`"), `:61`, `docs/doctrine/cercas.md:77`, `AGENTS.md:162`. Busca por SQL em `apps` e `packages/tools`, fora de teste: 49 arquivos. `SECURITY.md:83-85` descreve a cerca certo. Segundo ponto: `cercas.md:81` diz "documento não aponta para arquivo que não existe" e a cerca não lê `install/README.md` nem `.changes/` (`docs-point-to-existing-files.test.ts:14-18`). Terceiro: `cercas.md:72-87` lista 14 cercas; a pasta tem 15 (falta `system-access-is-allowlisted`) | Reescrever as quatro frases para "conexão direta com o banco" e acrescentar a 15ª cerca à tabela |
| 5.11 | Um check obrigatório que agrega | Conforme | `gh api repos/DeskLabs-OpenSource/DeskVoice/rulesets/27031185`: `required_status_checks: [{"context":"ready"}]`; `.github/workflows/ci.yml:336-360` | — |
| 5.12 | Check de contribuição só mede o que ela mudou | Conforme | `.github/workflows/ci.yml:32-82` (decide pelo caminho alterado); cerca vencida só avisa em PR (`fences/fences-have-owner-and-review-date.test.ts:47-52`) | — |
| 5.13 | Cada job diz de quem é a causa | Não conforme | Sete jobs têm o passo (`ci.yml:98,152,193,222,252,279,326`). `changes` (`:32-82`) não tem. `images` e `install` não passam `setup-outcome`, então sempre dizem "esta mudança". Efeito: se `changes` falha, o `ready` manda abrir um job que não explica nada | Acrescentar o passo `explain-failure` ao job `changes` |
| 5.14 | O CI instala do zero | Conforme | `ci.yml:134-135`: "Instalação nova (todas as migrations num banco vazio)". Execução `ci push main success fb50506` | — |
| 5.20 | O CI atualiza a partir da última versão, e o passo já rodou | Não se aplica | Não há versão publicada (`gh api .../tags`: 0). O passo existe e se pula (`ci.yml:136-143`) | — |
| 5.15 | O caminho central roda de ponta a ponta sem credencial, no CI | Conforme | `ci.yml:164-201` roda `apps/voice/src/simulated-call.db.test.ts`; CI da `main` verde. O comando `pnpm demo` existe (`package.json`) e não roda no CI; não o rodei (pede Docker) | — |
| 5.16 | As imagens constroem e sobem no CI | Não conforme | `ci.yml:241-251`: "Construir as três imagens, sem publicar". Nenhum passo sobe contêiner. Efeito: processo que quebra na partida chega a quem instala | Depois de construir, subir cada imagem com um Postgres e esperar a rota de saúde responder |
| 5.17 | Varredura de segredo no CI e antes do commit | Conforme | `ci.yml:287-334` (gitleaks com versão e resumo fixos); `.agents/skills/deskvoice-contribuir/scripts/hooks/pre-commit:13-33`. O hook só vale em clone que rodou `arm-hooks.sh` | — |
| 5.18 | Toda afirmação "o CI prova X" aponta para um job que faz isso | Não conforme | (a) `docs/decisions/0005-um-caminho-de-schema.md:45-46` e `docs/doctrine/versionamento.md:140-141` dizem que o CI atualiza a partir da última versão; o passo é pulado e nunca rodou. (b) `docs/doctrine/destrutivo-pede-confirmacao.md:99-100` diz "no teste da tela"; o painel não tem teste de tela (os oito arquivos de teste são de rota e de função). (c) `AGENTS.md:162` ("SQL cru"), ver 5.10. (d) `install/README.md:3-4` diz que nenhum script diz "pronto" sem conferir, ver 11.5. Nenhuma das frases nomeia o job | Em cada frase, nomear o job ou o teste e dizer "pulado até a primeira versão" onde for o caso; trocar "teste da tela" por "revisão" |
| 5.19 | Testes sem relógio real, porta fixa ou fuso | Não conforme | `packages/core/src/queue.db.test.ts:63` compara com `Date.now()` (folga de 60 s). Não achei porta fixa em escuta nem fuso. Dez pontos esperam tempo real de 10 a 50 ms (`setTimeout(resolve, N)`) | Comparar com o relógio do banco na mesma consulta, em vez de `Date.now()` |

## 6. Autenticação

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 6.1 | Tabela de decisões de autenticação, incluindo o que não existe | Não conforme | O desenho tem uma linha (`docs/specs/2026-11-10-fundacao-design.md:149`). Busca por "segundo fator", "token de API", "convite", "recupera" nos `.md`: nenhuma decisão | Uma tabela no desenho ou num registro de decisão, com as nove linhas do capítulo 06 |
| 6.2 | Uma função decide o papel | Conforme | `apps/panel/src/server/context.ts:164-166` (`requireRole`), chamada em `:208`. Busca por `.role`, `role ===`, `role !==` nas rotas: nenhuma comparação à mão. `ui/me.tsx:9` compara no navegador, só para esconder botão | — |
| 6.3 | A instalação nova chega à primeira tela útil sem passo de segurança não anunciado | Conforme | Não existe código de segundo fator nem de troca forçada de senha. Entrar cria a sessão e devolve o cookie (`auth/login/route.ts:46-47`; teste `auth.db.test.ts:24`). Não vi no navegador | — |
| 6.4 | Primeiro usuário pelo instalador; senha nunca como argumento | Conforme | `install/install.sh:320-326` (senha pela entrada padrão); `apps/routines/src/cli/create-owner.ts:73-80` (só aceita `--password-stdin`); teste `create-owner.db.test.ts:55` (não cria dois) | — |
| 6.5 | Recuperação de emergência encerra as sessões | Conforme | `apps/routines/src/cli/reset-password.ts:36`; teste `reset-password.db.test.ts:31`; `install/test/09-reset-password.sh` rodou: 18 verificações, 0 falhas. Não foi rodado num servidor real | — |
| 6.6 | Login não revela quem tem conta | Conforme | `auth/login/route.ts:36-41` (mesma mensagem, senha conferida contra um hash de isca); teste `auth.db.test.ts:39` | — |
| 6.7 | Bloqueio por tentativas não tranca outra pessoa pelo e-mail | Não conforme | `auth/login/route.ts:18-27` conta por e-mail; teste `auth.db.test.ts:52`: "blocks the e-mail after five failures, even with the right password". `SECURITY.md:79-82` admite o defeito. Efeito: quem sabe o e-mail do dono o impede de entrar | Contar por par e-mail + endereço de origem, mantendo o limite por endereço |
| 6.8 | Segredo de operador cifrado em repouso | Conforme | `apps/panel/src/server/settings.ts:32-37,52,74`; `trunks/route.ts:18`; testes `rules.db.test.ts:74,186` | — |
| 6.9 | O que o produto não tem está em "limites conhecidos" | Não conforme | `SECURITY.md:68-96` lista oito limites. Nenhum diz que faltam segundo fator, token de API, convite, gestão de equipe, troca de senha pela tela e recuperação por e-mail | Seis linhas na seção |
| 6.10 | Segundo fator opcional | Não se aplica | Não há segundo fator | — |
| 6.11 | Token de API | Não se aplica | Não há API pública com token | — |
| 6.12 | Sessão validada no servidor a cada requisição | Conforme | `context.ts:143-159` (busca a sessão no banco e confere a validade) chamado por `handle` em `:207`; teste `auth.db.test.ts:110` | — |
| 6.13 | Cada controle de segurança da tela tem teste de efeito | Conforme | Confiar no número de quem liga: `send_whatsapp.db.test.ts:43` (ligado envia) e `:169` (padrão pede confirmação). Padrão da aprovação: `request_approval.db.test.ts:82-108`. Ligações de saída: `outbound-policy.db.test.ts:46,51`. Texto do aviso de gravação: `call-session.db.test.ts:250-279` | — |
| 6.14 | Configuração de segurança mantém o último valor bom se a leitura falha | Conforme | O mecanismo é outro: não há cache. A configuração é lida a cada uso dentro da transação (`packages/tools/src/settings.ts:4-7`); se a leitura falha, a operação falha. Ausente ou inválido vale o mais restrito (`approval.ts:30`, `send_whatsapp.ts:131`). Nunca vale o mais permissivo | — |

## 7. Multiempresa

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 7.1 | Toda tabela tem organização | Conforme | `fences/every-table-has-organization-id.test.ts`; teste de catálogo `packages/core/test/isolation.db.test.ts:123` | — |
| 7.2 | Porta única; acesso direto reprovado | Conforme | `packages/core/src/with-org.ts:10-13`; `fences/no-raw-sql-outside-core.test.ts` reprova `import pg` e `.query(` | — |
| 7.3 | Porta de sistema só em arquivo listado | Conforme | `fences/system-access-is-allowlisted.test.ts`; lista com dez arquivos e motivo em `fences/system-access-allowlist.ts` | — |
| 7.4 | O teste tenta atravessar e lê o catálogo | Conforme | `packages/core/test/isolation.db.test.ts:40-52` (catálogo), `:170-227` (ler, alterar, mover, apagar e inserir pela outra organização), `:164` (tabela sem fábrica reprova) | — |
| 7.5 | O teste roda com o papel da aplicação, em banco criado pelo caminho do instalador | Conforme | `isolation.db.test.ts:111-116` (confere `deskvoice_app`, sem `BYPASSRLS`); `scripts/test-db-setup.ts:46` aplica as migrations com `runMigrations`, o mesmo executor do serviço `migrate`. As senhas dos papéis são definidas pelo teste, não pelo comando do instalador | — |
| 7.6 | Chaves entre tabelas levam a organização | Conforme | `db/migrations/20261110T230000_foundation.sql:59,117-118,140,153,169-170,187,203,238`; teste `isolation.db.test.ts:343` | — |
| 7.7 | Recurso compartilhado com regra de posse que falha fechado | Conforme | `docs/decisions/0007-endereco-de-operadora-compartilhado.md`; teste `apps/voice/src/trunks.test.ts:119,135,232` | — |
| 7.8 | Nenhuma rota assume uma organização só | Não conforme | `apps/panel/src/app/api/v1/system/health/route.ts:16` conta chaves de IA de todas as organizações, e `:28-31` soma as linhas de todas. A rota é pública. Efeito: com duas organizações, a que não tem chave vê "motor configurado", e qualquer visitante vê quantas linhas da instalação estão com problema | Na tela, responder pela organização da sessão; na rota pública, devolver só o estado das peças |
| 7.9 | A organização vem da sessão, da chave ou do segredo | Conforme | Rotas do painel: `context.ts:213` usa `session.organizationId`. Busca por `organizationId` em `app/api`: sempre da sessão. A API interna entre painel e voz recebe a organização no corpo, autenticada pelo `INTERNAL_TOKEN` (`apps/voice/src/internal-api.ts:36-39,90-92`); ver "Para a Fábrica" | — |
| 7.10 | O papel da aplicação não contorna o isolamento | Conforme | `foundation.sql:15` (`nobypassrls noinherit`); testes `isolation.db.test.ts:144` (sem participação em outro papel) e `:302` (não vira o papel de sistema) | — |
| 7.11 | Auditoria só de acréscimo | Não se aplica | Não há tabela de auditoria | — |

## 8. Administração

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 8.1 | Tudo o que o operador configura tem tela, ou decisão de que fica no servidor | Não conforme | Não há inventário. Ficam no servidor sem decisão escrita: usuários e senha (`install/reset-password.sh`), domínio, IP público, agendamento de backup, atualização | Uma tabela em `docs/` com duas colunas: tem tela; fica no servidor, com o motivo |
| 8.2 | Toda entidade criada pela tela se edita e se remove pela tela | Conforme | Agente: `agents/[id]/route.ts:11,17`. Linha: `trunks/[id]/route.ts:6,41`. Número: `phone-numbers/[id]/route.ts:9,21`. Lista de não ligar: `do-not-call/route.ts:12,23`. Testes `rules.db.test.ts:321-407`. Botões nas telas `agents/[id]/page.tsx:240` e `line/page.tsx:97,212`. Não vi no navegador | — |
| 8.3 | Toda tela tem porta no menu, com teste | Não conforme | Menu com sete entradas (`apps/panel/src/ui/shell.tsx:29-37`). Não existe teste que leia as telas do disco. `calls/talk/page.tsx` não está no menu | Um teste que liste `app/(app)/**/page.tsx` e confira contra `NAV`, com lista de exceções |
| 8.4 | A tela de saúde mostra cada peça e cada ligação | Não conforme | A rota devolve cinco linhas: painel, banco, Asterisk, linha, motor (`system/health/route.ts:38`). Não há linha para o processo de rotinas nem para o proxy. Efeito: rotinas paradas não aparecem na tela | Acrescentar a linha de rotinas (por exemplo, idade da tarefa mais antiga na fila) |
| 8.5 | Ação destrutiva pede confirmação nomeando o alvo | Não conforme | Com confirmação e alvo: agente (`i18n/pt-BR/agents.ts:43`), linha e número (`line.ts:46,52`). Sem confirmação: remover da lista de não ligar (`outbound/page.tsx:174` executa no clique), remover chave de IA (`settings/page.tsx:52`), conector de WhatsApp (`:224`) e webhook (`:276`). A doutrina do próprio projeto exige confirmação para a lista de não ligar (`docs/doctrine/destrutivo-pede-confirmacao.md:45-46`). Efeito: uma pessoa que pediu para não ser chamada volta a poder ser chamada por um clique errado | Usar nos quatro botões o mesmo passo de confirmação das telas de agente e de linha |
| 8.6 | Gestão de equipe e papéis pela tela | Não conforme | Não há tela nem rota de usuários (busca por "invite", "convite", "team", "equipe" em `app`, `ui`, `server`: só a chamada pelo navegador). **Em correção no ramo `feat/equipe-e-convites`** | A que está em curso naquele ramo |
| 8.7 | Painel da instalação separado | Não se aplica | A tela opera uma organização | — |
| 8.8 | Toda proteção ligada por padrão se anuncia na tela | Não medido | Faltou uma instalação nova rodando. A leitura mostra recusas com evento e aviso (`inbound.ts:57-58`, `outbound.ts:51`, `web-calls.ts:204`) e textos em `i18n/pt-BR/agents.ts:24`; não vi a tela | — |
| 8.9 | Tela vazia diz por quê; erro nomeia o item | Não medido | Faltou abrir as telas. Os dicionários têm texto de vazio para agentes, aprovações, chamadas, custos, números, webhooks (`i18n/pt-BR/*.ts`); `outbound.ts:29` diz só "A lista está vazia." | — |
| 8.10 | Cada integração tem teste de conexão e guia do lado do terceiro | Não conforme | Linha telefônica: tem (`trunks/[id]/check/route.ts`; teste `rules.db.test.ts:512`). Chave de IA, conector de WhatsApp e webhook: não há rota de teste (`settings/[key]/route.ts` só grava). O guia `docs/guides/primeira-ligacao.md:93-104` não diz como obter a chave, que plano o provedor exige nem quanto tempo a operadora leva | Um botão "testar" para a chave de IA; no guia, um parágrafo por terceiro |
| 8.11 | O nível de cada configuração está escrito | Não conforme | O desenho não tem essa tabela. No código, `settings` é por organização e os limites são por agente | Uma tabela no desenho: configuração, nível, onde se ajusta |
| 8.12 | Toda rota de administração valida o papel dentro dela | Conforme | Cada rota de escrita declara `configure: true` (15 ocorrências em `app/api/v1`); teste `rules.db.test.ts:39` (operador em toda rota de configuração) e `:394` | — |

## 9. Doutrinas

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 9.1 | Cada doutrina tem o caso de origem e a forma de cobrança | Não conforme | Sete das nove têm os dois. `docs/doctrine/sistema-vivo.md` não traz o caso de origem (ele está em `AGENTS.md:123`). `destrutivo-pede-confirmacao.md:99-100` aponta para um teste de tela que não existe | Uma seção "De onde vem" no sistema vivo; trocar "teste da tela" por "revisão" |
| 9.2 | Sistema vivo adotado: propósito, unidade, fronteira, um gate, par de medidas | Não conforme | Propósito e unidade: `sistema-vivo.md:11-12`. Fronteira: invariantes 4 e 7. Não há gate mecânico nomeado (a cobrança é a lista do PR, `:98-110`) nem par de medidas | Nomear um gate (por exemplo, o teste da chamada simulada) e duas medidas, uma de eficiência e uma de dano |
| 9.3 | Invariante deixado de fora tem motivo escrito | Não conforme | O manual tem nove invariantes e a regra do tempo. `sistema-vivo.md:21-96` tem sete. Ficaram de fora, sem motivo: laço de retorno, informação com propósito, regra do tempo | Um parágrafo dizendo por que cada um ficou de fora, ou incluí-los |
| 9.4 | As quatro perguntas de domínio respondidas por escrito | Conforme | Abuso e canal regulado: `docs/doctrine/ligacoes-de-saida.md`. Dado pessoal: `docs/guides/conformidade-brasil.md:43-52,59-67`. Ação sem volta em nome de alguém: `destrutivo-pede-confirmacao.md:83-93`. As respostas estão em três arquivos, não numa lista | — |
| 9.5 | Capacidade de risco nasce desligada, e o código impõe os limites | Conforme | `outbound-policy.db.test.ts:51` (desligada por padrão), `:59,70,93,116,127` (cada recusa); `rules.db.test.ts:278` (não liga sem finalidade e base legal); `create-owner.db.test.ts:17` | — |
| 9.6 | Controle legal anunciado tem padrão que o cumpre | Conforme | `apps/voice/src/call-session.ts:75,282` (aviso padrão quando a configuração está vazia); teste `call-session.db.test.ts:279`; chamada pelo navegador também (`web-calls.db.test.ts:194`) | — |
| 9.7 | O padrão de uma aprovação é do operador | Conforme | `packages/tools/src/approval.ts:24-31`; teste `request_approval.db.test.ts:82` (o modelo não escolhe) | — |
| 9.8 | Quem responde pelos dados, a retenção e como é executada | Não conforme | Quem responde: `docs/guides/conformidade-brasil.md:8,51-52`. Retenção: o guia diz que cabe ao operador definir; não há prazo nem rotina que apague transcrição. A única limpeza é de tarefas concluídas (`apps/routines/src/runner.ts:119`). Efeito: transcrições ficam para sempre | Escrever no guia que não há retenção automática e como apagar à mão; ou uma rotina com prazo ajustável |
| 9.9 | Doutrinas herdadas usam os nomes da tabela do capítulo 09 | Não conforme | Seis nomes batem. "Trabalho de agentes no repositório" está como `operacao-de-agentes.md`, nome que no produto irmão trata de outro assunto. Não existem as doutrinas de empacotamento e de prova em par | Renomear o arquivo e atualizar os links (a cerca `docs-point-to-existing-files` acusa o que ficar para trás) |
| 9.10 | Skill de doutrina | Conforme | `.agents/skills/deskvoice-doutrina/SKILL.md` | — |

## 10. Contribuição

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 10.1 | Repositório em organização | Conforme | `gh api repos/DeskLabs-OpenSource/DeskVoice`: `owner_type: Organization` | — |
| 10.2 | Os cinco documentos | Conforme | `CONTRIBUTING.md`, `GOVERNANCE.md`, `CREDITS.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, todos abertos | — |
| 10.3 | Regras de produto com o porquê de cada uma | Não conforme | `GOVERNANCE.md:25-26` diz que cada uma tem o porquê. As regras 1, 2, 3 e 7 têm ou apontam para a doutrina. As regras 4 (`:60-64`), 5 (`:66-69`) e 6 (`:71-74`) não têm | Uma frase de porquê em cada uma das três |
| 10.4 | Formato de pedido de decisão com padrão e prazo | Conforme | `GOVERNANCE.md:86-115` | — |
| 10.5 | Aprovação de quem não escreveu, e fila de merge | Não conforme | A regra está aplicada com passagem para o administrador da organização (`gh api .../rulesets/27031185`: `bypass_actors: OrganizationAdmin, pull_request`; `scripts/github/apply-ruleset.sh:49-51`). `gh pr list`: os PRs #2, #3 e #4 têm `reviewDecision: REVIEW_REQUIRED` e autor igual a quem mesclou. `gh run list`: nenhuma execução por `merge_group`. Não há registro de quem revisa com um mantenedor só. Efeito: três mudanças chegaram à `main` sem que outra pessoa ou agente as conferisse | Registrar quem revisa (um agente revisor distinto conta) e tirar o bloco `bypass_actors` |
| 10.6 | Skill de contribuição com pré-voo que só mede e hooks | Conforme | `.agents/skills/deskvoice-contribuir/scripts/preflight.sh:4,146` (sai sempre com 0); `hooks/pre-commit`, `hooks/pre-push` | — |
| 10.7 | As ferramentas medem contra o repositório original | Conforme | `preflight.sh:28`, `pre-commit:8`, `pre-push:8` (usam `upstream/main` quando existe); `who-am-i.sh:14,37` | — |
| 10.8 | Acolhida que não avalia e não baixa código | Conforme | `.github/workflows/welcome.yml` (sem `uses`); cerca `fences/welcome-does-not-checkout.test.ts`. Nunca comentou: as quatro execuções foram puladas, porque os PRs eram do próprio repositório | — |
| 10.9 | O modelo de contribuição diz o que é trabalho do projeto | Conforme | `CONTRIBUTING.md:102-108`; `.github/PULL_REQUEST_TEMPLATE.md:17-26` | — |
| 10.10 | Skills em pasta neutra; espelhos conferidos | Conforme | `.agents/skills/`; `fences/skills-mirror-is-in-sync.test.ts` | — |
| 10.11 | Procedimento de triagem | Não se aplica | A fila tem um PR, fechado | — |
| 10.12 | Quem responde, em quanto tempo e por qual canal | Conforme | `CONTRIBUTING.md:116-123` (uma pessoa, até 3 dias úteis, no PR ou na issue); `SECURITY.md:13-14`. Discussions não tem prazo | — |

## 11. Instalação

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 11.1 | Instalação em uma linha, num servidor recém-criado | Não medido | A linha única rodou uma vez, numa máquina compartilhada. Faltou um servidor recém-criado | — |
| 11.2 | Nenhum passo pede editar arquivo | Conforme | A instalação real usou respostas por variáveis. O instalador gera os três arquivos de ambiente (`install/_common.sh:101-128`). Quando 80/443 já são de outro proxy, ele pede uma linha na configuração desse proxy (`install/install.sh:351-364`), que não é arquivo do DeskVoice | — |
| 11.3 | Rodar o instalador de novo não muda nada | Não medido | O teste cobre só os segredos (`install/test/02-env-and-templates.sh:30-31`). Nenhum teste roda o `install.sh` fora da simulação. Faltou rodar duas vezes numa instalação real e comparar | — |
| 11.4 | Modo de ensaio e modo sem perguntas | Conforme | Rodei `bash install/install.sh --dry-run --yes`: saiu com 0, pasta de destino vazia. `install/test/04-dry-run.sh`: 42 verificações, 0 falhas | — |
| 11.5 | Nenhum script diz que deu certo sem conferir pelo caminho do usuário | Não conforme | `install/install.sh:335-350` espera a checagem de saúde e imprime o endereço. A checagem pergunta de dentro do contêiner (`install/healthcheck.sh:61,75`: `http://127.0.0.1:3000` e `:8090`). O endereço público, o Caddy e o certificado não são conferidos. Efeito: o instalador diz "Painel: https://..." com o domínio sem responder | Uma requisição ao endereço público no fim, com aviso claro se não responder |
| 11.6 | Saúde com linha por ligação e código de saída por gravidade | Não conforme | Código de saída 0, 1 ou 2: `install/healthcheck.sh:122-128`; teste `07-healthcheck.sh`: 51 verificações, 0 falhas. Ligação com linha própria: só voz → Asterisk (`:77-85`). Sem linha: proxy → painel, proxy → `/voice-ws` (admitido em `docs/decisions/0008-chamada-pelo-navegador.md:34`), painel → banco (a linha "Painel" sai sempre `ok`, `system/health/route.ts:38`), rotinas → banco (`:89`: só "processo rodando") | Três linhas: endereço público responde; `/voice-ws` responde; rotinas conectadas ao banco |
| 11.7 | O instalador grava com permissão explícita | Conforme | `install/_common.sh:83-92` (600), `:154` (644), `:165` (700), `:280` (600); teste com `umask 077` em `install/test/02-env-and-templates.sh:56`: 58 verificações, 0 falhas | — |
| 11.8 | Backup conferido por restauração; restauração por contagem | Conforme | `install/backup.sh:65-73`; `install/restore.sh:72-84,115-124`; `install/test/06-backup-restore.sh`: 65 verificações, 0 falhas, com Docker simulado. Não rodou contra um Postgres real nesta auditoria | — |
| 11.9 | Atualização exercitada entre duas versões | Não se aplica | Não há versão publicada | — |
| 11.10 | Diagnóstico com segredos mascarados | Conforme | `install/diagnose.sh:88` (tudo passa por `mask_secrets`); `install/test/05-diagnose.sh`: 23 verificações, 0 falhas | — |
| 11.11 | Proxy já existente é detectado | Conforme | `install/install.sh:171-198`; `install/test/04-dry-run.sh:10-27` | — |
| 11.12 | A versão em execução se vê de fora | Não conforme | `APP_VERSION` entra na imagem (`Dockerfile:22-23,28-29,44-45`) e nenhum código a lê (busca em `.ts` e `.tsx`: nenhuma ocorrência). Nenhuma rota devolve versão | Devolver `APP_VERSION` na rota pública de saúde |
| 11.13 | Instalado na VPS do parceiro e em outra | Não conforme | Uma instalação, na VPS de teste do parceiro (PR #3). Nenhuma em outro provedor. O registro foi criado por esta auditoria em `docs/fundacao/instalacao-real.md` | Instalar numa VPS de outro provedor e acrescentar ao registro |
| 11.14 | Erro do kit diz a causa e o próximo comando | Conforme | `install/_common.sh:38-43` (`die "<o que>" "<o que fazer>"`), `:49-53` (falha não prevista diz script e linha) | — |
| 11.15 | Nenhum padrão aponta para recurso que não sustenta produção sem avisar | Conforme | Sem domínio: avisa que não há HTTPS (`install/install.sh:222-223`). Agente de exemplo no motor simulado: avisa (`:383-384`). Sem imagem publicada: avisa (`:307`) | — |
| 11.16 | O instalador confere que a tela de entrada aceita o usuário criado | Não conforme | `install/install.sh:320-326` confere só que o usuário está no banco (`owner_exists`, `:72-76`). Não há tentativa de entrada | No fim, uma requisição a `/api/v1/auth/login` com a senha ainda em memória, antes do `unset` da linha 328 |
| 11.17 | O README declara os ambientes provados e o que fazer nos outros | Não conforme | `README.md:63` pede "Ubuntu 22.04 ou mais nova". Não diz em que provedor, arquitetura e modo a instalação foi provada, nem o que fazer em Debian, ARM, máquina local ou painel de hospedagem. `README.md:106` ainda diz que a instalação em VPS aguarda prova | Uma tabela curta: provado (onde, quando, como); não provado (o que se sabe e o que fazer) |
| 11.18 | Segredos separados por quem usa | Conforme | `install/_common.sh:13-16,101-128`; `deploy/docker-compose.yml:16,48` (só `migrate` recebe `migrate.env`); teste `02-env-and-templates.sh:24` | — |
| 11.19 | O kit recusa rodar de outra pasta | Não conforme | `require_install` (`install/_common.sh:310-316`) só confere que os arquivos de ambiente existem na pasta atual. Nada grava nem compara a pasta de origem (busca por "pasta da instala", "working_dir" em `install/`: nada). O projeto do Compose tem nome fixo (`deploy/docker-compose.yml:12`). Efeito: `install.sh` num segundo clone gera segredos novos e manda nos mesmos contêineres | Ler a pasta do projeto `deskvoice` em execução (`docker compose ls`) e recusar se for outra |
| 11.20 | Toda porta publicada tem uso naquele modo | Conforme | Com Caddy: 80, 443, 5060/udp e a faixa de áudio (`deploy/docker-compose.yml:96-98,123-124`). Com outro proxy: a porta de voz fica em `127.0.0.1` (`install/_common.sh:266-282`); teste `04-dry-run.sh:66-67` | — |

## 12. Distribuição

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 12.1 | Cerca: nenhum serviço de produção sem imagem publicada | Não conforme | A cerca não existe (15 arquivos em `fences/`, nenhum sobre o arquivo de composição) | Uma cerca que leia `deploy/docker-compose.yml` e reprove serviço sem `image` |
| 12.2 | Depois da primeira versão, instalar sem imagem é erro claro | Não conforme | `install/install.sh:305-311` e `install/update.sh:102-107` constroem na VPS quando o `pull` falha. Não há distinção entre antes e depois da primeira versão | Quando já existe etiqueta de versão, parar com erro e o comando a rodar |
| 12.3 | A instalação grava número de versão | Não conforme | `install/_common.sh:105` grava `DESKVOICE_VERSION=stable`; teste `install/test/08-update.sh:15` confirma "Atual: stable" | Resolver o canal para o número na hora de instalar e gravar o número |
| 12.4 | Nome da imagem e formato da versão com uma fonte só | Não conforme | O prefixo está em `.github/workflows/publish-image.yml:26`, `install/_common.sh:106` e `deploy/docker-compose.yml:44,55,67,83`. O formato diverge (`X.Y.Z` no CI, `vX.Y.Z` no atualizador) e foi contornado publicando as duas etiquetas (`publish-image.yml:89-94`) | Um arquivo lido pelos três lados, e um formato só |
| 12.5 | Imagens para as arquiteturas declaradas | Conforme | `publish-image.yml:87` (`linux/amd64,linux/arm64`). O workflow nunca rodou. `ROADMAP.md:74` ainda lista "Imagens ARM" como frente aberta | — |
| 12.6 | Etiqueta só nasce no CI, do ramo principal | Conforme | `.github/workflows/release.yml:102-165` (em `push` na `main`, só para commit vindo de um PR `release/<versão>` do próprio repositório) | — |
| 12.7 | Notas por fragmento; número calculado | Conforme | `fences/release-fragments-are-valid.test.ts`; `scripts/release/version.ts:12-24`; quatro fragmentos em `.changes/` | — |
| 12.8 | "Exige ação" é um bloco do fragmento | Conforme | `.changes/README.md` (seção "Quando o operador precisa agir"); `.changes/falar-com-o-agente.md` e `.changes/instalacao-em-servidor-endurecido.md` trazem `## Requer atenção` com o comando | — |
| 12.9 | Versão cortada inteira pelo CI | Não se aplica | Nenhuma versão foi cortada (`gh api .../releases`: 0) | — |
| 12.10 | Documentação e tela nos idiomas declarados | Não conforme | Tela: três dicionários. Documentação: o desenho declara pt-BR, inglês e espanhol (`docs/specs/2026-11-10-fundacao-design.md:144-146`); só o README está nos três, `CONTRIBUTING` em dois, o resto só em pt-BR. `ROADMAP.md:77` admite | Declarar quais documentos têm tradução, ou traduzir os que faltam |
| 12.11 | O "como fazer" mora no repositório e é conferido a cada versão | Não conforme | Mora: `docs/guides/` (seis guias). Conferido a cada versão: busca por essa etapa em `docs`, `.agents/skills`, `.changes/README.md`, `.github`: nada | Um item no texto do PR de versão (`release.yml:88-97`): "guias conferidos contra esta versão" |

## 13. Método

| Nº | Exigência | Resultado | Evidência | Menor correção |
|---|---|---|---|---|
| 13.1 | Desenho da fundação com decisões do dono e do construtor separadas | Conforme | `docs/specs/2026-11-10-fundacao-design.md:3-4,24-35,142-153` | — |
| 13.2 | A tabela de erros cobre `licoes.md`, lição por lição | Não conforme | `docs/specs/2026-11-10-fundacao-design.md:123-140`: 14 linhas, sem o identificador da lição e sem caminho do que cobra. `licoes.md` tem os grupos A a M | Uma linha por lição, com o caminho ou "ainda não cobrado" |
| 13.3 | Houve revisão fria, e o parecer está guardado | Não conforme | Houve: `fences/system-access-is-allowlisted.test.ts:3-4` cita "achado da revisão fria de 2026-11-11". O parecer não está no repositório | Guardar o parecer em `docs/fundacao/revisao-fria.md` |
| 13.4 | Cada bloqueador fechado, com a mudança | Não conforme | Sem o parecer, não há lista. Rastros: a cerca acima e `docs/decisions/0007` | Junto do parecer, uma tabela bloqueador → commit |
| 13.5 | Instalação real antes do lançamento | Não conforme | O repositório ficou público em 2026-11-11T12:09Z (`gh api`: `created_at`). O conserto do defeito achado na instalação entrou às 13:47Z (PR #3). O registro só passou a existir com esta auditoria | Não tem correção: o dono aceita por escrito, e a regra vale para o próximo produto |
| 13.6 | Lições devolvidas à Fábrica | Conforme | A Fábrica em `30797dc` traz as lições do DeskVoice: E7 a E11, K1 a K15 (`licoes.md:74-78,141-155`) | — |
| 13.7 | Um caminho de ponta a ponta pelas entradas reais, antes e depois da revisão fria | Não conforme | Não há registro. O que aconteceu: conversa por voz com motor real por um cliente de teste. Nem navegador nem operadora foram usados | Fazer a chamada pelo navegador real e guardar a saída |
| 13.8 | O dono usou, e o que não conseguiu está escrito | Não conforme | No commit medido o arquivo não existia. Criado por esta auditoria: `docs/fundacao/uso-pelo-dono.md` (sem commit) | Fazer o commit do arquivo |
| 13.9 | Lista do que está configurado e não foi exercitado | Não conforme | No commit medido o arquivo não existia (a lista morava só na Fábrica, `referencia.md`). Criado por esta auditoria: `docs/fundacao/nao-exercitado.md` (sem commit) | Fazer o commit do arquivo |

---

## O que `referencia.md` afirma sobre o DeskVoice, conferido

### "Configurado e ainda não exercitado"

| Afirmação | Conferência |
|---|---|
| Passo de atualização no CI nunca rodou | Confirmada: `ci.yml:139-143`; 0 tags |
| Fila de merge configurada, nenhuma contribuição a atravessou | Confirmada: regra com `merge_queue`; 0 execuções por `merge_group` |
| Publicação de imagens e corte de versão nunca rodaram | Confirmada no efeito, imprecisa na letra: `release.yml` rodou 4 vezes em `push` na `main` e saiu sem nada a marcar; `publish-image.yml` nunca rodou |
| Imagens para a segunda arquitetura | Confirmada |
| Atualizador nunca atualizou uma instalação | Confirmada: sem etiqueta, `update.sh:40` para com "Ainda não há nenhuma versão publicada" |
| Acolhida nunca disparou | Imprecisa: o workflow disparou 4 vezes e o job foi pulado (PRs do próprio repositório). Nunca comentou |
| Só o modo sem perguntas rodou numa máquina real | Confirmada (fato informado) |
| Só máquina compartilhada | Confirmada (fato informado) |
| O caminho central com provedores reais: só em simulação | **Desatualizada.** Houve uma conversa por voz com motor real em 11/11, por cliente de teste. Segue sem prova por navegador e por operadora |
| A tela mostra zero para os motores reais | Não confirmada: os dois motores têm preço e emitem uso (`gemini-live.ts:66-73,130-133`; `openai-realtime.ts:61-68,126-127`). Não vi a tela de uma chamada real |

### "Onde a referência diverge"

Confirmadas como estão: 4.1, 4.7, 4.5, 5.16, 6.1, 6.9, 8.3, 8.6 (em correção), 9.3, 12.1, 12.2, 12.3, 13.5 e o script da regra do ramo.

Desatualizadas ou imprecisas:

- **9.8:** a referência diz "num guia, e não numa doutrina". O item aceita guia. A lacuna medida é outra: a retenção não está escrita nem é executada.
- **10.5:** a referência fala das "primeiras contribuições". Hoje são três (#2, #3 e #4), todas mescladas pelo autor com revisão pendente.
- **"Ainda não medidos":** todos os itens daquela lista foram medidos aqui. 2.12 falha em mais do que contrato (ver o item). 2.15 é de nível C e a condição ainda não existe. 11.16 confirmada.

Divergências medidas aqui que a referência não lista: 1.4, 1.7, 2.4, 2.13, 2.16, 3.1, 3.3, 3.4, 4.2, 5.2, 5.10, 5.13, 5.18, 5.19, 6.7, 7.8, 8.1, 8.4, 8.5, 8.10, 8.11, 9.1, 9.2, 9.8 (retenção), 9.9, 10.3, 11.5, 11.6, 11.12, 11.13, 11.17, 11.19, 12.4, 12.10, 12.11, 13.2, 13.3, 13.4, 13.7, 13.8, 13.9.

---

## Para a Fábrica

### Itens ambíguos

- **2.4.** "As ocorrências dizem o mesmo" não tem critério. O capítulo 02, regra 2, pede textos diferentes em lugares diferentes (bloco, tabela de requisitos, guia de custos, fim do instalador). Sugestão: o item conferir que toda ocorrência do link diz que é de parceria.
- **2.10.** "Todo custo de provedor": o produto não tem como medir a conta da operadora nem a da VPS. O DeskVoice mede a IA e diz isso no guia. O item deveria dizer "custo que o produto origina e consegue medir".
- **2.14, 2.15.** "Primeiro uso real" não tem definição. Instalação de teste conta? Conversa por cliente de teste conta?
- **5.13.** "Cada job": vale para o job que decide o que roda e para o agregador?
- **5.14.** "O CI instala do zero" pode ser lido como instalar o sistema. A tabela do capítulo 05 fala de banco.
- **5.15.** O jeito de conferir é "o comando de demonstração". No DeskVoice o CI roda o teste do caminho central, e não o comando `pnpm demo`. São duas coisas.
- **7.9.** A API interna entre dois processos do produto recebe a organização no corpo, autenticada por um segredo que não prende a organização. O item diz "nunca do corpo". Falta dizer se chamada entre processos entra.
- **7.8.** Uma rota pública de saúde responde pela instalação. O item não diz o que ela pode mostrar quando há duas organizações.
- **8.1.** "O inventário" não tem nome nem lugar definidos.
- **1.4.** Não diz se o apontamento precisa estar no próprio `VISION.md`.

### Itens impossíveis de conferir do jeito indicado

- **6.3, 8.2, 8.4, 8.5, 8.8, 8.9** pedem execução na tela. Sem navegador dirigido, só dá para provar ausência pela leitura (8.4, 8.5) e nunca presença. Sugestão: o item apontar para o teste de tela que prova o comportamento, para virar item de arquivo.
- **12.2 e 12.11** são de nível F e dependem de existir uma versão ("depois da primeira versão", "a cada versão"). Antes dela, só se mede se o mecanismo está escrito.
- **13.5** não tem como ser corrigido depois da publicação. Falta dizer qual é a saída.
- **11.1 e 11.13** pedem um servidor recém-criado e duas VPS. A auditoria só consegue ler um registro; o item poderia ser "registro com evidência" nos dois.

### Itens duplicados

- **5.10 e 5.18:** uma cerca mais fraca que o texto reprova nos dois.
- **11.13 e 13.5:** os dois pedem o registro da instalação real.
- **13.9 e `referencia.md`:** a lista do que nunca foi exercitado mora na Fábrica e também é exigida no produto. A lição K11 aponta para `referencia.md`. Um lugar só.
- **11.5, 11.16 e a regra 3 do capítulo 11:** três vezes "conferir pelo caminho do usuário".

### Onde o DeskVoice contraria a régua por uma razão que parece boa

- **6.14.** A régua pede "manter o último valor bom". O DeskVoice não guarda valor em memória: lê a cada uso e, se a leitura falha, a operação falha. Não há valor antigo para envelhecer e nunca vale o mais permissivo. Marquei conforme pelo efeito; o texto do item descreve um mecanismo, e não o efeito.
- **5.12.** A cerca de data vencida avisa em PR e só reprova na `main` (`fences/fences-have-owner-and-review-date.test.ts:47-52`). É a regra do capítulo 05 aplicada a uma cerca, e não está escrita lá como exemplo.

### Defeitos que a lista não pegaria

- **O painel não tem nenhum teste de tela.** As doutrinas citam "teste da tela" como forma de cobrança. Nenhum item de conformidade pede que exista teste dirigindo o navegador.
- **Nenhum teste roda o `install.sh` fora da simulação,** nem com o Docker substituto. Os testes do kit cobrem funções e o modo de ensaio. O caminho que grava, sobe e cria o usuário só roda numa instalação real.
- **Lição K9 e o código divergem.** `licoes.md` diz "sem domínio, o painel sobe só local" e aponta para `install/install.sh`. No commit medido, sem domínio o painel abre pelo IP sem HTTPS (`install/install.sh:249,261`), e o teste afirma isso (`install/test/04-dry-run.sh:61-65`: "sem domínio: publica para fora"). Só fica local com `DESKVOICE_PANEL_LOCAL_ONLY=yes`. Nenhum item de conformidade cobre K9; 11.15 passa porque há aviso.
- **Lição K12 sem item.** `.github/dependabot.yml` agrupa versões menores e não trata as maiores; o PR #1 propôs uma versão maior no primeiro dia.
- **O hook de segredo é opcional.** 5.17 passa com o hook existindo; ele só vale em clone que rodou `arm-hooks.sh`.
- **9.9 só confere nomes.** A tabela do capítulo 09 lista empacotamento e prova em par como doutrinas herdadas; o DeskVoice não tem nenhuma das duas e nenhum item acusa a falta.

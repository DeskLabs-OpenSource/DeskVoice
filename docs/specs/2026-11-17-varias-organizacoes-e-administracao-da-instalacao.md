# Várias organizações e a administração da instalação

- **Estado:** desenho. Nenhuma fatia começou. A decisão que acompanha este texto é a
  [`0021`](../decisions/0021-varias-organizacoes-na-tela.md); onde as duas discordarem, vale a 0021.
- **Data:** 2026-11-17
- **Quem pediu:** o dono, em 13/11/2026 (roteiro de novembro, item R8): "um sistema multi-tenant com
  um painel de admin para a pessoa poder coordenar [...] o nosso público-alvo usa muito essa questão
  do multi-tenant para gerenciar vários clientes, fazer as configurações gerais de organizações,
  criar os tenants de organização, entre outras configurações que fazem sentido para o DeskVoice."
- **Quem desenhou:** o Arquiteto da empresa DeskVoice no Paperclip, a partir da `main` em `1b6a6c5`.
- **Ordem:** o código vem depois do R9 na trilha B. Quando entrar, anda sozinho: toca a sessão, o
  login, o processo de voz e a fila, e nenhuma fatia roda ao mesmo tempo que outra frente que mexa
  nos mesmos arquivos.

## 0. Em uma página

A fundação pôs `organization_id` em toda tabela e `withOrg` em todo acesso
([`0006`](../decisions/0006-organizacao-desde-o-primeiro-dia.md)). O banco já separa os clientes.
O que falta é **quem fica acima deles** e **uma pessoa poder estar em mais de um**.

O desenho em seis frases:

1. **Conta e vínculo se separam.** Nasce `accounts` (e-mail, senha e papel da instalação, sem
   organização). A tabela `users` continua igual e passa a ser o **vínculo** de uma conta com uma
   organização, com o papel que ela tem ali. Nenhuma chave estrangeira que aponta para `users` muda.
2. **Administração da instalação é uma marca na conta.** Enquanto a instalação tem uma organização
   só, todo dono dela administra a instalação, como hoje. Quando nasce a segunda, quem administra
   passa a ser uma lista explícita, e a tela diz quem está nela.
3. **A única leitura que atravessa organizações é a lista delas.** A visão geral, os limites e o
   "entrar como" abrem `withOrg` em cada organização, uma de cada vez. O SQL que enxerga mais de uma
   organização fica num módulo só de `packages/core`, com teste próprio.
4. **Suspender não derruba a linha.** A linha continua registrada, para que quem liga ouça uma fala
   gravada de "indisponível", sem gastar motor. Agentes não atendem, a fila não roda e a saída é
   recusada.
5. **"Entrar como" é um vínculo de suporte com prazo**, gravado numa tabela da própria organização.
   Por isso a organização enxerga o acesso pela mesma porta (`withOrg`) por onde enxerga o resto.
6. **Quem tem um cliente só não vê nada novo** na navegação principal. O seletor de organização só
   aparece para quem tem mais de uma, e a área da instalação mora no menu da conta.

## 1. O que existe hoje (lido em `1b6a6c5`)

| Peça | Onde | O que importa para este desenho |
|---|---|---|
| `organizations` | `db/migrations/20261110T230000_foundation.sql` | `id`, `name`, `created_at`. Sem estado |
| `users` | mesma migration, mais `20261111T150700_team_invites.sql` | `organization_id`, `email` **único na instalação**, `password_hash`, `role` (`owner`, `admin`, `operator`), `disabled_at`. Chave `(organization_id, id)` usada por `sessions`, `invites`, `organization_events`, aprovações e outras |
| `sessions` | mesma migration | `organization_id`, `user_id`, `token_hash`. A sessão é achada por `withSystem` em `apps/panel/src/server/context.ts` |
| Login | `apps/panel/src/app/api/v1/auth/login/route.ts` | Acha o usuário pelo e-mail, com `withSystem` |
| Convite | `packages/core/src/invites.ts` | Aceitar com um e-mail que já existe devolve `email_taken` |
| Papel | `requireRole` em `context.ts` | Um lugar só decide o que cada papel pode |
| Auditoria da organização | `organization_events` (`20261112T161000`) | Só de acréscimo, com `actor_user_id`. O vocabulário é `ORG_EVENT_KINDS` |
| Roteamento da chamada | `resolveInboundRoute` em `packages/core/src/routing.ts` | O tronco decide a organização, e o número só é procurado dentro dela |
| Recusa na entrada | `apps/voice/src/inbound.ts` | `no_agent`, `agent_disabled` e `inbound_limit_reached`. Fora da caixa postal, a recusa desliga **sem fala** |
| Fala gravada sem motor | `apps/voice/src/voicemail.ts`, `scripts/aviso-da-caixa-postal/gerar.sh` | Aviso em WAV por idioma, tocado pelo transporte. É o molde da fala de "indisponível" |
| Fila | `claimTask` em `packages/core/src/queue.ts` | Reivindica por `withSystem`, sem olhar a organização |
| Custo | `usage_ledger` | Por chamada e por organização. Há teto por chamada no agente (`cost_ceiling_cents`). **Não existe teto mensal por organização** |
| Saída | `outbound_policy`, por organização, nasce desligada | `checkOutboundAllowed` é a única porta |
| Atualização | `system/update`, `apps/panel/src/server/update.ts` | Hoje é pedida por dono ou administrador **da organização**, e atualiza a instalação inteira |
| Linhas por IP | decisão [`0007`](../decisions/0007-endereco-de-operadora-compartilhado.md), `apps/voice/src/trunks.ts` | Endereço disputado por organizações diferentes derruba as linhas por IP das duas |
| Portas de `withSystem` | `fences/system-access-allowlist.ts` | Onze arquivos, cada um com motivo |
| Cerca de organização | `fences/every-table-has-organization-id.test.ts` | Isenta só `organizations` e `schema_migrations` |

Duas coisas que hoje já são da instalação moram na organização de quem pediu:

- **o pedido de atualização** (`update_requests.organization_id` é de quem pediu, e a atualização é
  de todos);
- **o IP público** (`network.public_ip` é lido por organização em `trunks.ts`, e o servidor é um só).

O primeiro precisa mudar de dono (seção 6). O segundo funciona como está e fica fora.

## 2. O que aprendemos do DeskcommCRM

Lido em `origin/main` `f22d2022f` (16/11/2026), em `app/api/v1/admin/`. O que se aproveita é a
regra, nunca a forma: lá a proteção depende de função `security definer` e de privilégio de serviço,
e aqui depende de `withOrg`.

| O que lá existe | O que aproveitamos | O que fica de fora |
|---|---|---|
| `tenants/[id]/delete`: só apaga organização **já suspensa**, com o nome digitado e um motivo, e uma "lápide" permite retomar a limpeza interrompida | As três condições e a lápide (fatia 9) | A exigência de segundo fator: o DeskVoice não tem ([`0009`](../decisions/0009-autenticacao.md)) |
| `tenants/[id]/suspend`: numa transação só, muda o estado, falha as tarefas pendentes e grava o evento | Mesma transação, com as tarefas canceladas e com motivo (fatia 4) | Os tipos de suspensão por cobrança: cobrança está fora (pedido 1) |
| `tenants/[id]/impersonate`: acompanhamento com prazo, modo `full` ou `support_readonly`, auditado no começo e no fim | Prazo, motivo, auditoria nas duas pontas (fatia 5) | O modo só de leitura entra depois, se pedirem: dobra a superfície de papel |
| `platform-admins`, `audit`, `usage`, `dashboard/kpis`, `tenants/[id]/health` | Lista de quem administra, auditoria da instalação, visão geral com custo e saúde | `incidents`, `lgpd/requests` e `inbox`: o DeskVoice já tem os direitos do titular por organização ([`0014`](../decisions/0014-direitos-de-quem-ligou-pela-tela.md)) |
| `cobranca/*` (planos, régua, checkout) | Nada | Fora deste roteiro (pedido 1) |

O crédito vai no `CREDITS.md` na fatia que trouxer cada regra.

## 3. O contrato

### 3.1 Conta, vínculo e papel da instalação

```sql
create table accounts (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  -- Nula = não administra a instalação. Ver 3.2 para a regra de quem administra.
  installation_admin_at timestamptz,
  -- A organização em que a conta entrou por último: o login volta para ela.
  last_organization_id uuid references organizations (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table users add column account_id uuid references accounts (id);   -- not null depois de preencher
alter table users add column kind text not null default 'member' check (kind in ('member', 'support'));
create unique index users_one_membership_idx on users (organization_id, account_id);
```

- A migration cria uma conta por usuário. Hoje o e-mail é único na instalação, então a
  correspondência é de um para um e não tem conflito a resolver.
- `password_hash` sai de `users` na mesma migration. O painel, o processo de voz e as rotinas sobem
  juntos na atualização, então não existe janela em que código velho leia a coluna. **Não medido:**
  a fatia 1 confere isso no teste de atualização sobre banco com dados.
- `users.email` deixa de ser único na instalação e passa a ser único por organização. Ele continua
  existindo como cópia para a tela da equipe, e só uma função de `packages/core` o grava, junto com
  `accounts.email`.
- `accounts` não tem `organization_id`. **O papel `deskvoice_app` não recebe nenhum direito sobre
  ela.** Só o papel de sistema a lê, e só por funções de `packages/core/src/accounts.ts`. A senha de
  todas as contas nunca fica ao alcance de uma rota presa a uma organização.
- `users.kind = 'support'` é o vínculo do "entrar como" (3.6). Esse vínculo não aparece na tela da
  equipe, não entra na contagem de donos e nunca entra no login.

**A sessão** ganha `account_id`, e o par `organization_id` e `user_id` passa a dizer em que
organização ela está agora. Trocar de organização é uma função de `packages/core`
(`switchOrganization`). Ela confere que a conta tem um vínculo `member` ativo no destino e muda o par
na mesma linha de `sessions`. O cookie não muda.

### 3.2 Quem administra a instalação

`isInstallationAdmin(db, accountId)` é a única função que responde. A regra:

1. Se a conta tem `installation_admin_at`, administra.
2. Se a instalação tem **uma organização só**, e a conta é dona ativa dela, administra também. É o
   que garante que quem tem um cliente só não perde nada: tudo o que um dono faz hoje continua
   fazendo.
3. Quando a **segunda** organização é criada, na mesma transação, todo dono ativo da primeira que
   ainda não tem a marca a recebe. A partir daí a lista é explícita, a tela da instalação a mostra, e
   o item 2 deixa de valer.

A migration da fatia 1 não marca ninguém, porque o item 2 já cobre toda instalação de hoje.

Regras da lista: sempre existe pelo menos uma pessoa administrando. Quem administra põe e tira outra
conta da lista, e não tira a última. Um terceiro papel por cima não existe.

**Saída de emergência:** `bash install/grant-installation-admin.sh <e-mail>`, rodado de dentro da
VPS, dá a marca a uma conta. É o mesmo raciocínio de `install/reset-password.sh`: quem tem acesso
ao servidor já é dono da instalação.

### 3.3 Organização

```sql
alter table organizations add column suspended_at timestamptz;
alter table organizations add column suspended_reason text;
alter table organizations add column deleting_at timestamptz;   -- a lápide (fatia 9)
```

| Ação | Quem | Regra |
|---|---|---|
| Criar | administração | Nome obrigatório. Nasce com a política de saída desligada, como toda organização, e com os padrões da instalação copiados (3.5). A tela oferece o convite do primeiro dono na mesma hora |
| Renomear | administração, e o dono da própria organização | Igual à tela de hoje para o dono |
| Suspender | administração | Motivo obrigatório (10 a 500 caracteres). Não suspende a organização em que a própria pessoa está no momento, e nunca deixa a instalação sem uma organização ativa |
| Reativar | administração | Nada do que foi cancelado na suspensão volta sozinho |
| Excluir | administração | Só organização suspensa. Pede o nome digitado e um motivo (lei [`destrutivo-pede-confirmacao.md`](../doctrine/destrutivo-pede-confirmacao.md)). Nunca a última |

**O que a suspensão faz**, numa transação só e por `withOrg` da organização suspensa:

- Marca `suspended_at` e o motivo.
- Cancela as tarefas `queued` daquela organização, com o motivo `organization_suspended`. A religação
  combinada há duas semanas não pode sair sozinha no dia da reativação.
- Grava `organization_suspended` em `organization_events` e em `installation_events`.

**E o que passa a valer enquanto ela está suspensa:**

| Onde | O que acontece | Quem confere |
|---|---|---|
| Ligação recebida pela operadora | Atende, toca a fala gravada de "indisponível" no idioma do agente do número (ou o padrão) e desliga. A recusa vira chamada `refused` com `end_reason = organization_suspended`, evento `call_refused` e frase na linha do tempo | `apps/voice/src/inbound.ts`, antes de olhar agente |
| Ligação pelo WhatsApp | A mesma fala, pelo mesmo transporte | `apps/voice/src/whatsapp-calls.ts` |
| Chamada pelo navegador e simulada | Recusadas com a mensagem de organização suspensa | rotas `calls/web` e `calls/simulate` |
| Ligação de saída | `checkOutboundAllowed` recusa com `organization_suspended` | a porta única de saída |
| Fila | `claimTask` não reivindica tarefa de organização suspensa. A tarefa que entrar depois fica na fila e é cancelada na reativação, com o mesmo motivo | `packages/core/src/queue.ts` |
| Linhas | **Continuam registradas.** Tirar a linha do ar faria quem liga ouvir o erro da operadora, e não a fala | `trunks.ts` não muda |
| Mensagem de WhatsApp | Não responde, e grava evento | sem resposta automática, que seria disparo |
| Painel | Quem só tem vínculo com ela vê a tela "Esta organização está suspensa", com o motivo, e mais nada. Quem tem outras organizações troca para elas | `requireSession` |

**A fala gravada** segue o molde do aviso da caixa postal: um WAV por idioma, gerado por script
versionado. O texto proposto, em pt-BR: "Este número está temporariamente indisponível. Por favor,
tente mais tarde." A fala não diz o motivo, porque o motivo é da agência com o cliente, e não de quem
liga.

### 3.4 Limites por organização

```sql
create table organization_limits (
  organization_id uuid primary key references organizations (id),
  monthly_spend_cap_cents integer check (monthly_spend_cap_cents >= 0),
  max_trunks integer check (max_trunks >= 0),
  max_agents integer check (max_agents >= 0),
  outbound_allowed boolean not null default true,
  updated_at timestamptz not null default now()
);
-- RLS como as outras, e a organização LÊ os próprios limites, mas não os escreve:
grant select on organization_limits to deskvoice_app;
grant select, insert, update, delete on organization_limits to deskvoice_system;
```

- Coluna nula = sem limite. Organização sem linha aqui é organização sem limite nenhum, que é o caso
  de toda instalação de hoje.
- **Limite só aperta.** Nenhum limite da instalação afrouxa uma regra da organização nem uma regra do
  produto. `outbound_allowed = true` não liga a saída; só deixa a organização decidir, como hoje.
  `false` desliga a saída e trava o interruptor dela. O teto diário por linha, a janela e a lista de
  não ligar não ganham campo aqui (antipadrão 16).
- **O teto mensal** é conferido no começo de cada chamada (recebida, de saída, pelo navegador e pelo
  WhatsApp): a soma de `usage_ledger.cost_cents` do mês corrente, no fuso da organização, chegou ao
  teto → a chamada é recusada com a mesma fala de "indisponível", `end_reason =
  spend_cap_reached`, e um aviso no painel (um por janela, como o teto de simultâneas). O teto por
  chamada do agente continua valendo durante a ligação.
- **Linhas e agentes:** criar além do limite é recusado na rota, com a contagem na mensagem. Baixar o
  limite abaixo do que já existe não apaga nada; só impede criar mais.
- A tela da organização mostra os limites dela em Configurações, só para leitura, com a frase "definido
  pela administração da instalação".

**Não medido:** a soma do mês inclui custo estimado e não inclui o consumo que não pôde ser medido
(R4). O teto é, portanto, aproximado, e a tela diz isso ao lado do campo.

### 3.5 Configurações gerais

```sql
create table installation_settings (
  key text primary key,
  value jsonb not null,
  secret boolean not null default false,
  updated_at timestamptz not null default now()
);
-- Sem organization_id. Só o papel de sistema lê e escreve.
```

A lista é curta de propósito. Cada item diz se a organização sobrescreve.

| Chave | O que é | A organização sobrescreve? | Como vale |
|---|---|---|---|
| `defaults.language` | Idioma do agente e da tela de uma organização nova | Sim, sempre | **Copiado na criação.** Mudar o padrão não mexe em quem já existe |
| `defaults.timezone` | Fuso de uma organização nova (política de saída e relatórios) | Sim, sempre | Copiado na criação |
| `defaults.limits` | Os limites com que uma organização nova nasce, inclusive `outbound_allowed` (padrão: `false`) | Não: limite é da administração | Copiado na criação |
| `engine.<id>.api_key` | Chave de provedor de IA da instalação, cifrada com `encryptSecret` | Sim: a chave própria da organização vem antes | **Valor vivo**, só para as organizações em que a administração ligou "Usar a chave da instalação". Depende do pedido 2 |

O que **não** entra, com o motivo:

- O texto do aviso de gravação, a caixa postal, o prazo de guarda e a memória continuam só da
  organização. São escolhas de privacidade do cliente diante de quem liga, e não da agência.
- O IP público, que já funciona por organização.

**A chave da instalação, se o pedido 2 valer:**

- O processo de voz procura a chave da organização. Se não achar, e a organização tiver
  `organization_limits.uses_installation_engine_key = true` (coluna que entra junto com esta chave),
  usa a da instalação, lida por uma função de `packages/core` (`installationEngineKey`).
- O custo continua indo para o `usage_ledger` **da organização da chamada**, e o teto dela vale.
- A organização nunca vê a chave nem o teste dela. A tela de motores diz "usando a chave da
  instalação".
- A rota pública de saúde soma como hoje (0006). Uma organização que usa a chave da instalação conta
  como "com chave".

### 3.6 Entrar como

```sql
create table support_accesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- O vínculo de suporte (users.kind = 'support') criado para este acesso.
  user_id uuid not null,
  reason text not null check (char_length(reason) between 10 and 500),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
-- RLS como as outras: a organização vê os acessos que recebeu, pela mesma porta de sempre.
```

- **Só a administração da instalação.** O motivo é obrigatório. O prazo vem de uma lista fechada:
  15, 30 ou 60 minutos. Não se renova; acabou, começa outro, com motivo novo.
- O acesso cria (ou reativa) um vínculo `support` da conta na organização, com papel `admin`. **Nunca
  `owner`:** quem dá suporte não mexe em dono, não exclui nada que a lei da organização reserve ao
  dono e não muda a própria lista de suporte.
- A sessão passa para a organização pelo mesmo `switchOrganization`, com `support_access_id`. A
  conferência da sessão (`findSession`) passa a recusar a sessão de suporte depois de `expires_at`
  ou de `ended_at`, e então volta a sessão para a organização de origem.
- Toda a tela mostra uma faixa fixa: "Você está dando suporte a <organização> até <hora>. Motivo:
  <motivo>." Com o botão "Encerrar".
- A ação feita durante o suporte fica gravada com o `user_id` do vínculo de suporte. O nome que
  aparece é "<nome> (suporte da instalação)".
- **Rastro nas duas pontas:** `support_access_started` e `support_access_ended` em
  `organization_events` da organização, e `installation_events` com a mesma informação.
- **A organização vê:** na tela Equipe, uma seção "Acessos de suporte", com quem, quando, até
  quando e o motivo, para todos os papéis que veem a tela Equipe. A lista lê `support_accesses` por
  `withOrg`.

### 3.7 Visão geral

Uma tela, só da administração, com uma linha por organização:

| Coluna | De onde vem |
|---|---|
| Nome e estado (ativa, suspensa) | `organizations` |
| Chamadas nos últimos 30 dias | `calls`, por `withOrg` |
| Custo do mês, com as marcas "inclui estimativa" e "não medido" de R4 | o mesmo cálculo da tela de Custos (`system/costs`), por `withOrg` |
| Linha: quantas conectadas e quantas caídas | o mesmo cálculo da saúde, por `withOrg` |
| Motor: com chave própria, com a chave da instalação, sem chave, chave com falha | `settings`, por `withOrg` |
| Fila: tarefas em atraso e falhas nas últimas 24 horas | `tasks`, por `withOrg` |
| Teto do mês e quanto já foi usado | `organization_limits` e o custo acima |

**A lista de organizações é a única leitura que atravessa.** A função de `packages/core`
`listOrganizations` devolve `id`, `name` e o estado. Cada número da tabela é calculado dentro de
`withOrg(id)`, pela mesma função que a tela daquela organização já usa. Com dezenas de organizações
são dezenas de transações curtas, o que cabe numa VPS. **Não medido:** o tempo com cem
organizações.

Exportação em CSV fica fora.

### 3.8 Auditoria da instalação

```sql
create table installation_events (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  kind text not null,                -- vocabulário fechado: INSTALLATION_EVENT_KINDS
  actor_account_id uuid references accounts (id) on delete set null,
  organization_id uuid references organizations (id) on delete set null,
  payload jsonb not null default '{}'
);
-- Só de acréscimo, como organization_events. Só o papel de sistema.
```

O vocabulário: `installation_admin_granted`, `installation_admin_revoked`, `organization_created`,
`organization_renamed`, `organization_suspended`, `organization_reactivated`,
`organization_deleted`, `organization_limits_changed`, `installation_setting_changed`,
`support_access_started`, `support_access_ended`, `update_requested`.

Toda ação da administração **sobre uma organização** também vai para `organization_events` dela,
para o cliente ver na própria tela. A ação sobre a instalação (dar a marca, mudar padrão) só vai para
cá. A exclusão grava aqui o nome, o motivo e a contagem de linhas apagadas por tabela, porque a
organização deixa de existir.

### 3.9 Onde mora o código que atravessa organizações

| Arquivo | O que faz | Por que atravessa |
|---|---|---|
| `packages/core/src/accounts.ts` | Login, troca da senha, aceitar convite com conta que já existe, `switchOrganization`, `isInstallationAdmin` | A conta não tem organização |
| `packages/core/src/installation.ts` | `listOrganizations`, criar, suspender, reativar, a lápide da exclusão, `installation_events`, `installation_settings` | É a camada acima das organizações |
| `packages/core/src/queue.ts` | `claimTask` passa a pular organização suspensa | Já atravessava |
| `packages/core/src/routing.ts` | `resolveInboundRoute` devolve também se a organização está suspensa | Já atravessava |

No painel, **um arquivo novo** entra em `fences/system-access-allowlist.ts`:
`apps/panel/src/server/installation.ts`, o embrulho das rotas da administração
(`handleInstallation`), com o motivo "confere o papel da instalação antes de qualquer consulta". As
rotas da área da instalação não chamam `withSystem`: chamam as funções acima ou abrem `withOrg` na
organização-alvo. O login e o `context.ts` já estão na lista e continuam com o mesmo motivo.

A cerca de organização (`every-table-has-organization-id.test.ts`) isenta três tabelas novas:
`accounts`, `installation_settings` e `installation_events`. Cada uma ganha dono, motivo e data de
revisão (antipadrão 11). As três têm RLS ligado, sem policy para `deskvoice_app` e sem direito
concedido a ele: se alguém um dia der `grant` por engano, a tabela continua sem linhas visíveis.

### 3.10 Telefonia por organização

| Peça | Como separa hoje | O que muda |
|---|---|---|
| Linha registrada (usuário e senha) | Pela conta, na organização da linha | Nada |
| Linha por IP | Decisão 0007: endereço de organizações diferentes derruba as duas | Pedido 3 |
| Número de entrada | `phone_numbers` por organização, procurado só dentro da organização do tronco | Nada |
| WhatsApp (sessão no WAHA) | Uma sessão por organização, `whatsapp_sessions` | Nada. A exclusão desconecta a sessão (fatia 9) |
| Ligação pelo WhatsApp | `whatsapp_call_sessions` por organização | A suspensão a cobre (3.3) |
| Política de saída | `outbound_policy` por organização | Ganha a trava de `outbound_allowed` (3.4) e a recusa por suspensão |

O custo assumido da 0007 muda de dono. Ela dizia "quem pode provocar isso é quem administra o
servidor, porque criar uma segunda organização exige acesso à VPS". Com esta mudança, quem cadastra
a linha é o dono de uma organização cliente: um cliente pode derrubar a linha por IP de outro só
cadastrando o mesmo endereço. Isso é o pedido 3.

## 4. Critério de aceite (o R8 inteiro)

O que uma pessoa consegue fazer quando terminar:

1. Quem administra a instalação cria duas organizações e convida a mesma pessoa para as duas. Ela
   aceita o segundo convite com a senha que já tem, troca entre as duas pelo seletor, sem sair, e
   em cada uma vê só o que é dela. Um teste de tela faz esse caminho.
2. Ao suspender uma organização, os agentes dela param de atender. Quem liga para um número dela
   ouve a fala de indisponível, e a linha do tempo mostra a recusa com a frase. Um teste com banco
   real e o transporte simulado prova.
3. O "entrar como" aparece na auditoria da instalação e na tela Equipe da organização, com motivo e
   prazo, e deixa de valer no prazo. Um teste prova que, na sessão de suporte, nada da organização
   de origem nem de uma terceira aparece em nenhuma rota.
4. Uma instalação de antes atualiza sem nenhuma ação manual. O CI aplica as migrations sobre um banco
   da última versão com dados, entra com a conta de antes e encontra a mesma organização, o mesmo
   papel e o mesmo botão de atualizar.
5. `pnpm verify`, `pnpm test:db` e os testes de tela verdes, e o teste de isolamento gerado cobre as
   tabelas novas que têm `organization_id`.

**Fracasso, mesmo funcionando:**

- Uma leitura que atravessa organizações fora das funções da seção 3.9.
- "Entrar como" sem rastro em alguma das duas pontas, ou que sobrevive ao prazo.
- Quem tem um cliente só vendo a tela de agência: o seletor, a palavra "instalação" na navegação
  principal ou um passo novo no login.
- A senha de qualquer conta ao alcance de `deskvoice_app`.
- Um limite da instalação que afrouxa a saída, o teto por linha ou a lista de não ligar.
- A suspensão que deixa quem liga em silêncio, ou que derruba a linha de outra organização.

## 5. Fatias

Cada uma cabe numa revisão de uma sentada, e cada uma deixa a `main` usável. A ordem importa: as
fatias 1 e 2 mudam login e sessão, e todas as outras dependem delas.

### Fatia 1: contas e o papel da instalação (sem nada visível)

- Migration: `accounts`, `users.account_id` (preenchido, depois `not null`), `users.kind`,
  `sessions.account_id`, `password_hash` saindo de `users`, `installation_events`,
  `organizations.suspended_at` e o motivo (só as colunas, sem uso).
- `packages/core/src/accounts.ts` com login, troca de senha e `isInstallationAdmin`. O login, a troca
  de senha, `create-owner` e `reset-password` passam a usar a conta.
- A atualização (`system/update`) passa a exigir `isInstallationAdmin`. Em toda instalação de hoje
  isso é o mesmo dono de antes (3.2, item 2).
- `install/grant-installation-admin.sh` e o arquivo em `apps/routines/src/cli/`, listado em
  `system-access-allowlist.ts`.
- Cerca: isenção de `accounts` e `installation_events`, com dono, motivo e data.
- **Aceite:** atualização sobre banco com dados, e a mesma pessoa entra, com o mesmo papel, na mesma
  organização. Um teste lê `accounts` como `deskvoice_app` e recebe erro de permissão.
- **Sensível:** autenticação. Passa pelo dono.

### Fatia 2: a área da instalação e a lista de organizações

- Menu da conta: "Administrar a instalação", só para quem administra. A área tem Organizações,
  Administração e Auditoria.
- Criar e renomear organização. Na organização nova, gerar o convite do primeiro dono (o convite de
  hoje, aberto em `withOrg` da organização nova).
- Lista de quem administra, com pôr e tirar, e a regra de 3.2, item 3, ao criar a segunda.
- Auditoria: lista de `installation_events`.
- **Aceite:** com uma organização só, a navegação principal fica idêntica à de antes (teste de tela
  compara os itens). Criar a segunda grava `organization_created` e marca os donos da primeira.

### Fatia 3: pessoas em várias organizações e a troca

- Convite para um e-mail que já tem conta: a página do convite pede a senha dessa conta, e não uma
  senha nova. A resposta não diz se a conta existe antes de a pessoa abrir um convite válido.
- Seletor de organização no topo, só para quem tem mais de um vínculo ativo. `switchOrganization`.
- Login volta para `last_organization_id`, ou para o vínculo mais antigo.
- Desativar o vínculo numa organização não mexe nos outros. Trocar a senha encerra as sessões da
  conta em todas.
- **Aceite:** o item 1 da seção 4.
- **Sensível:** autenticação. Passa pelo dono.

### Fatia 4: suspender e reativar

- Ações na área da instalação, com motivo. A transação de 3.3.
- Fala gravada de indisponível (WAV por idioma, script versionado), tocada pela operadora e pelo
  WhatsApp. `organization_suspended` entra no vocabulário de fim de chamada, com frase na linha do
  tempo.
- `claimTask` pula a organização suspensa. `checkOutboundAllowed` recusa. As rotas de chamada pelo
  navegador e simulada recusam. Tela de organização suspensa.
- **Aceite:** o item 2 da seção 4, com a recusa vinda da operadora e do WhatsApp, e uma tarefa
  agendada que não roda.
- **Sensível:** telefonia e fila. Passa pelo dono.

### Fatia 5: entrar como e o rastro

- `support_accesses`, vínculo `support`, faixa fixa, encerrar, prazo, `findSession` conferindo o
  prazo, as duas pontas da auditoria, a seção "Acessos de suporte" em Equipe.
- **Aceite:** o item 3 da seção 4. O teste de vazamento percorre **todas as rotas `GET`** do painel
  numa sessão de suporte, com dado em três organizações, e confere que nenhuma resposta traz `id`
  de outra.
- **Sensível:** autenticação e isolamento. Passa pelo dono.

### Fatia 6: visão geral

- A tabela de 3.7, reaproveitando as funções de custo, saúde e fila que as telas da organização já
  usam. Se uma delas mora na rota, ela desce para `packages/core` antes, num commit à parte.
- **Aceite:** com duas organizações, cada linha mostra o número que a tela da própria organização
  mostra. Um teste compara.

### Fatia 7: limites por organização

- `organization_limits`, a tela de limites na área da instalação, a leitura em Configurações da
  organização, o teto mensal no começo das chamadas, a contagem de linhas e agentes, e a trava da
  saída.
- `defaults.limits` em `installation_settings` (a tabela nasce aqui), copiado na criação.
- **Aceite:** um teste por limite. Um teste prova que `outbound_allowed = true` não liga a saída de
  uma organização que a tem desligada.

### Fatia 8: configurações gerais

- `defaults.language` e `defaults.timezone`, copiados na criação.
- Se o pedido 2 valer como está: a chave de IA da instalação, `uses_installation_engine_key`, a
  leitura no processo de voz e a frase na tela de motores.
- **Aceite:** uma chamada de uma organização sem chave, com a da instalação ligada, grava custo no
  `usage_ledger` dela e respeita o teto dela.

### Fatia 9: excluir organização

- Só suspensa. Nome digitado e motivo. A lápide (`deleting_at`) e uma rotina que retoma a limpeza
  depois de reinício.
- Migration que troca toda chave estrangeira para `organizations (id)` por `on delete cascade`,
  gerada a partir do catálogo, e um teste com banco real, também gerado do catálogo, que reprova a
  chave nova que não tiver cascata. Assim, a tabela que nascer depois também é apagada sem ninguém
  lembrar.
- Depois do banco: as gravações da pasta da organização, a sessão do WAHA, o arquivo de linhas do
  Asterisk e as contas que ficaram sem vínculo nenhum e sem a marca da instalação.
- `installation_events` com nome, motivo e contagens.
- **Aceite:** uma organização com uma linha em **cada** tabela (gerada do catálogo) é apagada, e a
  outra organização continua com as mesmas contagens.
- **Sensível:** apaga dado. Passa pelo dono.

### Fatia 10: posse de endereço por IP (depende do pedido 3)

Só entra se o pedido 3 for B. Com A, a 0007 continua como está, e só a frase de custo da 0007 é
atualizada, na decisão 0021.

## 6. O que fica de fora

- **Cobrança dos clientes** (planos, Stripe, Asaas): pedido 1. O padrão é ficar de fora; a visão
  geral mostra o custo para a agência cobrar por fora.
- Domínio, logotipo e cor por organização (marca branca).
- Escolha da organização na tela de login. A conta entra na última organização usada e troca depois.
- Modo de suporte só de leitura.
- Segundo fator para quem administra a instalação: continua o padrão da 0009.
- Exportação da visão geral em CSV.
- Mover o IP público para a instalação.
- Qualquer limite que aumente o que uma organização pode discar.

## 7. Pedidos de decisão

Os três vão para o lote do Líder, no formato do `GOVERNANCE.md`. Enquanto não houver resposta, as
fatias 1 a 7 e a 9 andam: nenhuma depende deles.

### Decisão: a cobrança dos clientes entra no DeskVoice?

**Quem decide:** dono do projeto
**O que está parado esperando:** nada; define só o que fica fora do R8.

#### Opções
- **A.** Fora deste roteiro. A agência cobra por fora, e a visão geral mostra o custo do mês por
  organização. Custo: a agência copia o número para a ferramenta de cobrança dela.
- **B.** Planos e cobrança dentro (Stripe ou Asaas, como o DeskcommCRM). Custo: conta em terceiro,
  segredo de cobrança, régua de inadimplência e suspensão automática. É um produto a mais, e esbarra
  em "sem recurso pago" do `GOVERNANCE.md`, que precisa ser lido de novo para quem cobra o próprio
  cliente.

#### Recomendação
A, porque quem usa ganha a visão de custo agora sem depender de serviço externo.

#### Se ninguém responder em 7 dias, vale: A

#### Não medido
Quantas agências do público cobram por consumo e quantas por mensalidade fixa.

### Decisão: a chave de IA da agência pode servir a todos os clientes?

**Quem decide:** dono do projeto
**O que está parado esperando:** a fatia 8, na parte da chave.

#### Opções
- **A.** Pode, ligada por organização pela administração. O custo vai para a organização da
  chamada, e o teto dela vale. A chave própria da organização vem antes. Custo: uma chave lida fora
  da organização, por uma função de `packages/core`, e uma frase a mais na tela de motores.
- **B.** Não. Cada organização cadastra a própria chave. Custo: a agência repete a mesma chave em cada
  cliente, e cada repetição é uma cópia cifrada a mais para trocar quando a chave vazar.

#### Recomendação
A, porque é como a agência já trabalha, e o custo continua medido e com teto por cliente.

#### Se ninguém responder em 7 dias, vale: A

#### Não medido
Se os termos de uso de Google e OpenAI permitem uma chave servir a clientes de terceiros: não
conferido nesta data.

### Decisão: linha por IP no mesmo endereço, com clientes diferentes na mesma instalação

**Quem decide:** dono do projeto
**O que está parado esperando:** a fatia 10. As outras andam.

#### Opções
- **A.** A 0007 continua como está: endereço disputado por organizações diferentes derruba as linhas
  por IP das duas. A tela diz isso **antes** de salvar, com confirmação. Só a frase de custo da 0007
  muda: quem provoca agora pode ser o dono de uma organização cliente. Custo: um cliente pode derrubar
  a linha por IP de outro, e a agência resolve trocando um deles para linha por registro.
- **B.** Posse pela administração da instalação. A linha por IP nova, num endereço que já é de outra
  organização, é gravada como "esperando a administração" e não sobe. A que já funcionava continua.
  A administração decide de quem é o endereço. Custo: uma tela e um estado a mais. Enquanto a decisão
  não vem, se a operadora já mandar as ligações do cliente novo, elas chegam à organização antiga e
  são recusadas ali, e o número de quem ligou fica no histórico da organização errada.
- **C.** Proibir linha por IP quando a instalação tiver mais de uma organização. Custo: quem usa
  operadora que só autentica por IP precisa de uma instalação por cliente.

#### Recomendação
A, porque é a regra que já passou por três revisões de segurança, e não vaza dado de um cliente para
outro em nenhum momento.

#### Se ninguém responder em 7 dias, vale: A

#### Não medido
Quantas operadoras do público autenticam só por IP. Se a operadora manda as ligações antes de o
cliente terminar o cadastro, o que pesa contra B.

## 8. Riscos e o que não se sabe

- **A troca de `password_hash` de tabela** é a parte mais arriscada da fatia 1. Se o teste de
  atualização mostrar que algum processo lê a coluna antiga durante a subida, a coluna sai numa
  migration seguinte, numa versão depois.
- **O vínculo de suporte com papel `admin`** pode alcançar ações que hoje só o dono faz, se alguma
  rota usar `CONFIG_ROLES` onde deveria pedir dono. A fatia 5 lista as rotas que o papel `admin`
  alcança e confere uma por uma.
- **A rota pública de saúde** soma as organizações (0006). Com organização suspensa, a soma pode
  dizer "linha caída" por causa de uma linha que está de pé, mas suspensa. A fatia 4 decide se a
  organização suspensa entra na soma, e diz na tela.
- **A cópia de `users.email`** pode divergir de `accounts.email` se alguém escrever fora da função de
  `packages/core`. Hoje não existe troca de e-mail na tela; quando existir, nasce nessa função.

## 9. Não medido neste desenho

- Não rodei nenhum teste. Tudo o que está aqui foi lido em `1b6a6c5`, sem executar.
- Não conferi onde mora hoje o idioma e o fuso "da organização". Li `agents.language` e
  `outbound_policy.timezone`; a fatia 8 confere se há outro lugar.
- Não conferi todas as rotas que o papel `admin` alcança (risco da seção 8).
- Não medi o tempo da visão geral com muitas organizações.
- Não conferi os termos de uso dos provedores de IA sobre chave compartilhada.
- Do DeskcommCRM li só as rotas `impersonate`, `suspend` e `delete` e a lista de pastas de
  `app/api/v1/admin/`, e não a área `app/admin` nem as migrations de lá.

# 0021: Várias organizações na tela, e a administração da instalação

- **Estado:** aceita. O dono respondeu ao lote de decisões em 17/11/2026, às 17:11Z: "Pode seguir
  com recomendação". Valeu a recomendação de cada pedido da seção 7 do desenho: esta decisão aceita,
  a cobrança fora (A), a chave de IA da agência servindo aos clientes (A) e a 0007 como está para as
  linhas por IP (A). Os itens marcados **[dono]** abaixo dizem o que ficou valendo.
- **Data:** 2026-11-17
- **Quem decidiu:** o dono pediu no roteiro de novembro (R8, 13/11/2026). As escolhas abaixo são do
  Arquiteto, no [desenho de várias organizações](../specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md),
  e ficam abertas à revisão do dono.
- **Atualiza:** [`0006`](0006-organizacao-desde-o-primeiro-dia.md) e
  [`0009`](0009-autenticacao.md). Revê a frase de custo da [`0007`](0007-endereco-de-operadora-compartilhado.md)
  conforme o pedido 3.

## Contexto

A 0006 pôs organização em toda tabela e disse: "Operar várias empresas na mesma tela está fora do
escopo." Ela também previu este pedido: "Implementadores [...] atendem vários clientes. O pedido para
operar mais de uma empresa vai chegar." O pedido chegou no R8.

A 0009 diz que o e-mail é único na instalação, que cada pessoa tem um papel e que "várias empresas
escolhidas no login" esperam o dono, junto com a multiempresa na tela.

## Decisão

### O que muda na 0006

- A tela passa a operar **várias organizações por instalação**. O banco não muda de forma: toda
  tabela de produto continua com `organization_id`, todo acesso de produto continua por `withOrg`, e o
  teste de isolamento continua gerado do catálogo.
- **Três tabelas da instalação nascem sem `organization_id`:** `accounts`, `installation_settings` e
  `installation_events`. O papel `deskvoice_app` não tem nenhum direito sobre elas. Só funções de
  `packages/core` as leem, pelo papel de sistema. A cerca de organização as isenta com dono, motivo e
  data de revisão.
- **As operações que atravessam organizações ganham quatro itens**, todos em `packages/core`:
  listar as organizações, criar, suspender e reativar, apagar com lápide, e conferir quem administra a
  instalação. A visão geral **não** atravessa: lê cada organização por `withOrg`, uma de cada vez.
- No painel, só o embrulho das rotas da administração (`apps/panel/src/server/installation.ts`)
  entra em `fences/system-access-allowlist.ts`.

### O que muda na 0009

| Tema | Antes | Agora |
|---|---|---|
| Onde fica a senha | `users.password_hash` | `accounts.password_hash`. Uma conta, uma senha, em todas as organizações |
| E-mail | Único na instalação, em `users` | Único na instalação, em `accounts`. Em `users`, único por organização |
| O que é `users` | A pessoa | O **vínculo** da conta com uma organização, com o papel dela ali |
| Papéis | Dono, administrador e operador | Os mesmos, em cada organização, mais a **administração da instalação**, que é uma marca na conta, e não um quarto papel de organização |
| Quem administra a instalação | Não existia | Um **estado gravado**, e não a contagem de organizações. Antes da segunda organização, o dono e o administrador da organização de quem instalou (as mesmas pessoas que hoje atualizam). Criar a segunda grava, para sempre, que a lista ficou explícita: ela nasce com os donos da organização fundadora e nunca fica vazia. Excluir ou suspender organizações depois não muda quem administra |
| Convite para e-mail que já tem conta | Recusado (`email_taken`) | Aceito com a senha da conta. Nenhuma senha nova |
| Escolher a organização | Não existia | O login entra na última organização usada. A troca é feita na tela, sem sair, e o seletor só aparece para quem tem mais de uma |
| "Várias empresas escolhidas no login" **[dono]** | Esperando o dono | Continua fora: a conta entra e troca depois. O que entrou foi a troca dentro da tela |
| Saída de emergência | `install/reset-password.sh` | O mesmo, mais `install/grant-installation-admin.sh` |
| Entrar como | Não existia | Só quem administra a instalação, com motivo, com prazo de 15, 30 ou 60 minutos, com papel de administrador (nunca dono), gravado na auditoria da instalação e na da organização, e visível na tela Equipe dela. O vínculo de suporte não mexe na equipe (convite, papel, desativação), não é escolhido nem avisado, e fica desativado fora do prazo |

O resto da 0009 vale como está: sem cadastro aberto, convite de uso único e com prazo, os tetos de
tentativa de login, a redefinição de dentro do servidor e a ausência de segundo fator.

### Os limites só apertam

Os limites que a administração define por organização (teto de gasto do mês, linhas, agentes e se a
saída pode ser ligada) só restringem. Nenhum deles liga a saída, aumenta o teto por linha, afrouxa a
janela ou contorna a lista de não ligar (antipadrão 16).

### Quem tem um cliente só não percebe

Uma instalação de antes atualiza sem ação manual. A pessoa entra com a mesma senha, cai na mesma
organização, com o mesmo papel, e o botão de atualizar continua com ela, seja dona ou administradora. A navegação principal não
muda. A área da instalação fica no menu da conta.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Manter `users` com a senha e criar uma linha de usuário por organização, cada uma com senha própria | A mesma pessoa teria uma senha por cliente, e o login precisaria perguntar a organização antes da senha, o que revela quais organizações existem |
| Trocar `users` por `accounts` mais uma tabela de vínculo nova | Toda chave estrangeira que aponta para `users (organization_id, id)` (sessões, convites, aprovações, eventos) teria de mudar junto. Manter `users` como vínculo não toca em nenhuma |
| Papel de instalação como um quarto valor em `users.role` | O papel de organização mora dentro de uma organização. Quem administra a instalação não pertence a uma, e a marca em `users` precisaria ser repetida em cada vínculo |
| Visão geral com uma consulta só que soma todas as organizações pelo papel de sistema | É o desenho em que um esquecimento vaza. Uma transação por organização usa as mesmas funções que a tela de cada uma já usa |
| "Entrar como" pela sessão da própria pessoa, sem vínculo na organização | O que se faz durante o suporte precisa de autor dentro da organização (aprovação decidida, configuração mudada). Sem vínculo, o autor seria nulo ou de outra organização |
| Suspender tirando as linhas do Asterisk | Quem liga ouviria o erro da operadora, e não uma fala. Viola o antipadrão 15 |

## Consequências

**Boas:**

- A agência coordena os clientes numa instalação só, e o isolamento continua cobrado por máquina.
- Uma pessoa atende vários clientes com uma senha.
- O suporte da agência deixa rastro que o cliente vê.

**Custos:**

- **Três tabelas sem organização.** Cada uma é um lugar onde o isolamento depende só de não dar
  direito a `deskvoice_app`. Um teste com banco real lê cada uma com esse papel e espera erro de
  permissão.
- **O login e a sessão mudam**, que é caminho sensível. As fatias que tocam neles passam pelo dono.
- **A exclusão de organização** passa a depender de toda chave estrangeira para `organizations (id)`
  ter cascata. Um teste gerado do catálogo cobra isso da tabela que nascer depois. As exceções são
  nomeadas no teste com motivo: o registro da instalação (`installation_events`) e a última
  organização da conta ficam com `set null`.
- **Uma terceira forma de tabela de organização:** "a organização lê, o sistema escreve"
  (`organization_limits`), cobrada pelo teste de isolamento gerado ao lado das tabelas só de
  acréscimo.
- **[dono] Linhas por IP de clientes diferentes com faixas que se sobrepõem** (o `host` e os extras
  da linha por IP). A frase de custo da 0007 ("criar uma segunda organização exige acesso à VPS")
  deixa de ser verdade. **Respondido A (17/11):** a 0007 continua como está, com aviso antes de
  salvar. Quem provoca a sobreposição agora pode ser o dono de uma organização cliente.
- **[dono] Cobrança dos clientes:** **respondido A (17/11):** fica fora deste roteiro. A visão geral
  mostra o custo do mês por organização, para a agência cobrar por fora.
- **[dono] Chave de IA da agência para todos os clientes:** **respondido A (17/11):** pode, ligada
  por organização pela administração, com o custo na organização da chamada e o teto dela valendo. A
  chave própria da organização vem antes. Como dizia a recomendação aceita, a chave só começa depois
  de conferidos os termos de uso de cada provedor, com fonte e data, no PR da fatia 8. O provedor
  cujos termos proibirem fica fora da chave da instalação. O guia da fatia 8 diz também que
  conferir os termos do próprio contrato continua sendo do operador.

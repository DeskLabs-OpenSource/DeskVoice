# 0015: Stack do painel e do empacotamento

- **Estado:** aceita, registro retroativo
- **Data:** 2026-11-12
- **Quem decidiu:** o construtor, na fundação (2026-11-10), dentro do espaço que o desenho deixa
  para quem constrói ([desenho da fundação](../specs/2026-11-10-fundacao-design.md), "Decisões do
  construtor" e "O que fica para quem constrói"). O dono não foi consultado sobre estas quatro escolhas uma a uma.
- **Origem:** item 3.1 da [medição de conformidade de 12/11](../fundacao/conformidade-2026-11-12.md).

> **Este registro foi escrito depois das escolhas.** O painel em Next.js, o Caddy, o Docker
> Compose e o monorepo pnpm estão no código desde a fundação, e até aqui só tinham uma linha cada
> no desenho. O que segue documenta o que pesou e o que cada escolha custa hoje, para quem propuser
> trocar uma delas saber o que já foi considerado. Não é uma decisão nova, e as alternativas
> abaixo foram reconstruídas a partir do código e dos registros que já existiam, não de uma ata
> da época.

## Contexto

O DeskVoice roda inteiro na VPS de quem instala, e é distribuído como código. Quatro escolhas de
estrutura sustentam isso, e cada uma vale para as outras:

- três processos de produto (painel, voz, rotinas) que dividem tipos, acesso ao banco e
  ferramentas;
- uma tela que é também a API, porque toda configuração de operador tem tela
  ([`AGENTS.md`](../../AGENTS.md), convenção 7);
- uma entrada só, com HTTPS quando há domínio, para o painel e para a voz do navegador
  ([0008](0008-chamada-pelo-navegador.md), [0011](0011-sem-dominio-o-painel-nao-vai-para-a-internet.md));
- uma instalação que alguém sem experiência de servidor sobe com um comando, e atualiza pela tela
  ([0010](0010-atualizar-pela-tela.md)).

O irmão DeskcommCRM usa a mesma família: na `main` dele em 2026-11-12 (commit `4f93e227b4`),
`package.json` declara `next` 16 e `pnpm@9.15.9`, e a raiz tem um `Caddyfile` e dez arquivos
`docker-compose*.yml`.

## Decisão

### 1. Painel e API em Next.js

O painel é um app Next.js ([`apps/panel`](../../apps/panel)), com React e Tailwind. As telas e a
API (`apps/panel/src/app/api/v1/`) moram no mesmo processo; a construção sai em modo
`standalone` (`apps/panel/next.config.ts`), e a imagem `deskvoice-panel` só roda esse servidor.
As telas ao vivo usam eventos enviados pelo servidor (SSE).

| Alternativa | Por que não |
|---|---|
| Página estática (React com Vite) e um servidor de API à parte | Dois artefatos para construir, versionar e publicar, e um contrato entre eles que só existe para separar o que a tela e a rota já dividem: o mesmo `withOrg`, a mesma sessão, os mesmos tipos |
| Servidor de API com páginas montadas no servidor por modelo de texto, sem React | Cada tela ao vivo (linha do tempo, chamada pelo navegador, pedido de aprovação) viraria script escrito à mão. A família do Deskcomm já tem React |
| Outro framework React de servidor | Nenhum ganho medido que pagasse sair da família do Deskcomm, onde quem contribui já conhece o Next.js |

**Custo:**

- A construção do painel é a mais pesada das três imagens, e a mais sujeita a mudança de versão
  maior do framework. Não foi medido quanto tempo nem quanta memória ela leva.
- O Next.js decide coisas por convenção de pasta e de nome (rotas, cache, o que roda no servidor).
  Quem contribui precisa conhecer essas regras, e uma atualização maior pode mudá-las.
- Com `next dev`, as páginas recarregaram sozinhas em laço em 2026-11-12, e os testes de tela
  passaram a rodar contra o painel construído
  ([skill de contribuir](../../.agents/skills/deskvoice-contribuir/SKILL.md), passo 6).

### 2. Caddy como entrada única

Um Caddy ([`deploy/Caddyfile`](../../deploy/Caddyfile)) existe em toda instalação e é a única
porta do painel e da voz do navegador: `/voice-ws` vai para a voz, o resto vai para o painel, e
a rota do agente de atualização responde 404 por fora. Com domínio, ele publica nas portas 80 e
443 com HTTPS; sem domínio, só em `127.0.0.1` ([0011](0011-sem-dominio-o-painel-nao-vai-para-a-internet.md)).

| Alternativa | Por que não |
|---|---|
| Nginx com um emissor de certificado à parte | Duas peças para configurar, renovar e testar, onde o Caddy do repositório faz as duas com o `Caddyfile` que está acima |
| Traefik, configurado por rótulos no Compose | A rota passaria a morar espalhada nos serviços. Aqui ela cabe num arquivo só, de 46 linhas, versionado e revisado como código |
| Sem proxy: o painel publicado direto | Sem HTTPS, a senha do dono trafegaria aberta, e a voz do navegador precisaria de uma segunda porta ([0008](0008-chamada-pelo-navegador.md)) |

**Custo:**

- Um contêiner a mais em toda instalação, inclusive na que já tem outro proxy na frente. Nesse
  caso são dois proxies em fila, e o endereço do visitante passa a depender de quantos saltos o
  painel conta ([0008](0008-chamada-pelo-navegador.md), "Endereço do visitante").
- Quem já opera Nginx ou Traefik não pode trocar o Caddy pelo seu: o modo "atrás de outro proxy"
  põe o Caddy do DeskVoice atrás do dele, não no lugar.

### 3. Docker Compose como empacotamento

Um arquivo só, [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml), com os serviços
(banco, migração, painel, voz, rotinas, Asterisk, Caddy e o WhatsApp num perfil), mais um
`docker-compose.override.yml` que o instalador grava com o que muda por instalação. As imagens do
produto vêm prontas do endereço de `deploy/images.env`, e as de terceiros estão fixadas por resumo.
O instalador instala o Docker pelo script oficial, depois de perguntar (`install/install.sh`).

| Alternativa | Por que não |
|---|---|
| Pacotes da distribuição e serviços do systemd, sem contêiner | Node, Postgres 17 e Asterisk 20 na versão certa em cada sistema aceito (Ubuntu, Debian, AlmaLinux, Rocky): um caminho de instalação por distribuição, e uma atualização que mexe no sistema de quem usa |
| Kubernetes, ou uma distribuição pequena dele | Uma VPS só. A camada a mais de conceitos fica entre quem instala e o primeiro "pronto" |
| Um contêiner único com todos os processos dentro | Atualizar uma parte reinicia todas, e a saúde de cada processo deixa de ser visível separada |

**Custo:**

- O Docker é pré-requisito: a instalação depende do script oficial dele e da rede para baixar as
  imagens. Imagem só para amd64 ([0013](0013-imagens-so-amd64.md)).
- O Asterisk precisa de UDP e de uma faixa de portas de áudio publicadas, e a rede do Docker é
  mais uma camada onde a ligação pode ficar muda (a checagem de saúde confere a faixa, não o
  caminho).
- Toda mudança de serviço passa pelo atualizador, que precisa ser provado contra uma instalação
  com dados (antipadrão 8 do [`AGENTS.md`](../../AGENTS.md)).

### 4. Monorepo pnpm

Um repositório, com `apps/*` e `packages/*` declarados em `pnpm-workspace.yaml`, e a versão do pnpm
fixada em `packageManager` no `package.json`. Os três pacotes têm mais de um consumidor:
`@deskvoice/core` e `@deskvoice/tools` são usados pelos três apps, e `@deskvoice/voice-engine`
pelo painel e pela voz.

| Alternativa | Por que não |
|---|---|
| Um repositório por pacote, publicado num registro | Uma mudança de contrato viraria vários PRs em ordem e uma versão por pacote. As cercas, que leem o repositório inteiro, deixariam de ver o todo |
| Um pacote só, sem divisão | Os três processos carregariam o que não usam, e a fronteira entre núcleo, ferramentas e motores, que o [`GOVERNANCE.md`](../../GOVERNANCE.md) usa para decidir o que entra no núcleo, deixaria de ter forma no código |
| Workspaces do npm ou do Yarn | Não houve comparação. O pnpm é o da família do Deskcomm |

**Custo:**

- Quem contribui precisa do pnpm, na versão fixada. Quem chega com `npm install` recebe erro.
- Um PR em `packages/core` afeta os três apps de uma vez.

## O que não foi conferido

- Nenhuma das alternativas foi construída ou medida aqui. Os "por que não" são o raciocínio a
  partir do código e dos registros [0008](0008-chamada-pelo-navegador.md), [0010](0010-atualizar-pela-tela.md),
  [0011](0011-sem-dominio-o-painel-nao-vai-para-a-internet.md) e [0013](0013-imagens-so-amd64.md),
  não de um teste.
- Nenhuma afirmação sobre Nginx, Traefik, Kubernetes ou npm foi conferida na documentação deles
  nesta data. Quem propuser uma troca começa por essa conferência.
- Tempo de construção e memória de cada imagem não foram medidos por serviço. O número medido que
  existe é o do produto inteiro parado ([`AGENTS.md`](../../AGENTS.md), passo zero).

## Consequências

- Propor trocar uma destas peças é mudança de arquitetura: pede um registro novo que cite este,
  com o custo da troca para quem já instalou ([`GOVERNANCE.md`](../../GOVERNANCE.md)).
- A linha "Stack" do [`AGENTS.md`](../../AGENTS.md) continua sendo o resumo; este registro é o
  porquê.

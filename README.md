<div align="center">

Português · [English](README.en.md) · [Español](README.es.md)

<h1>
  <a href="https://deskvoice.com.br"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/deskvoice-logo-dark.svg">
    <img src="brand/deskvoice-logo-light.svg" alt="DeskVoice" height="76">
  </picture></a>
</h1>

**Central telefônica open source operada por agentes de IA, instalada na sua VPS.**

O agente atende a ligação, executa ferramentas durante a conversa, pede aprovação a um humano
quando precisa, transfere e deixa tarefas rodando depois que a chamada termina.

**[deskvoice.com.br](https://deskvoice.com.br)** · [Instalar](https://deskvoice.com.br/instalar) · [Guias](https://deskvoice.com.br/guias) · [Notas de versão](https://deskvoice.com.br/changelog)

[![Site](https://img.shields.io/badge/site-deskvoice.com.br-a2552f)](https://deskvoice.com.br)
[![CI](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml/badge.svg)](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-green)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Instalação própria](https://img.shields.io/badge/instala%C3%A7%C3%A3o-na%20sua%20VPS-orange)](install/install.sh)

[Visão](VISION.md) · [Arquitetura](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Contribuir](CONTRIBUTING.md) · [Primeira ligação](docs/guides/primeira-ligacao.md)

</div>

---

> **Estado do projeto: com versões publicadas.** A instalação, a atualização pela tela, o
> backup, a restauração e a volta automática de uma atualização que falhou já rodaram numa VPS
> real, e um contribuidor já fez ligações reais com o motor OpenAI Realtime. O que está provado, o
> que é experimental e o que ainda é plano estão separados na seção "O que ele faz hoje". Não há
> data prometida para nada do roadmap.

## Instalar

> **Parceria de infraestrutura: HostGator.** O DeskVoice é gratuito, sem versão paga e sem recurso
> travado. Quem sustenta o projeto é a parceria com a HostGator, e o kit de instalação foi feito
> pensando na VPS dela: um comando, poucas perguntas, nenhuma variável para editar.
>
> **[Contratar a VPS da HostGator pelo link da parceria](https://www.hostgator.com.br/52708-141-3-52.html)**
>
> Usar esse link é o jeito de apoiar o projeto. Qualquer outra VPS com Docker funciona pelo mesmo
> comando, sem nenhuma diferença de recurso.

### Na sua VPS

Entre na VPS por SSH e rode uma linha:

```bash
curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/get.sh | bash
```

Ela baixa o DeskVoice em `~/DeskVoice` e abre o instalador. Prefere ler antes de rodar? O mesmo
resultado, passo a passo:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice && bash install/install.sh
```

O instalador confere a máquina e a rede, faz poucas perguntas (domínio, nome da empresa, seu
nome, e-mail e senha), gera todos os segredos, sobe os serviços, cria o primeiro usuário e
mostra o endereço do painel. Se faltar o Docker, ele pergunta e instala. Você não edita variável
de ambiente à mão. Rodar de novo não quebra nada.

Daí em diante tudo se configura pela tela: o tronco SIP, o número, a chave de IA e o agente.
Nenhum recurso exige SSH para ser ligado.

| O que ter em mãos | Observação |
|---|---|
| Uma VPS Ubuntu 22.04 ou mais nova (Debian 12+, AlmaLinux 9+ e Rocky Linux 9+ também são aceitos; o que foi provado em cada um está em [`install/README.md`](install/README.md#sistemas-aceitos)) | A [VPS da HostGator](https://www.hostgator.com.br/52708-141-3-52.html), parceira do projeto, é a recomendada. Qualquer VPS com Docker serve, pelo mesmo comando. Sobre memória, só o que foi medido: a instalação foi provada numa VPS de 8 GB e 4 vCPU, e o DeskVoice parado usa cerca de 380 MiB de memória e ocupa cerca de 2,7 GB de disco (medidos na 0.3.0, sem o WhatsApp). O menor tamanho em que a instalação cabe ainda não foi medido. As imagens publicadas são para processador x86_64 (amd64); em ARM a instalação constrói na própria máquina, com `--build` ([por quê](docs/decisions/0013-imagens-so-amd64.md)) |
| Um domínio apontado para a VPS | Opcional para testar. Sem domínio não há HTTPS: o painel fica só dentro da VPS e você entra por túnel SSH (o instalador mostra o comando) |
| Um tronco SIP com um número | Contratado com a operadora de telefonia de sua escolha. Autenticação por registro ou por IP |
| Uma chave de IA de voz | Gemini (Google) ou OpenAI. Você paga o uso direto ao provedor |

O passo a passo completo, do zero à primeira chamada, está em
[`docs/guides/primeira-ligacao.md`](docs/guides/primeira-ligacao.md).

### Instalando com um assistente de IA

Usa Claude Code, Codex, Cursor ou outro assistente de código? Cole isto nele:

```text
Me ajude a instalar o DeskVoice: https://github.com/DeskLabs-OpenSource/DeskVoice
Leia o AGENTS.md do repositório e siga a skill deskvoice-instalar.
```

A primeira pergunta dele é se você já tem um servidor. Se não tiver, ele diz o tamanho de máquina
que basta e mostra o link da VPS da HostGator, o mesmo do bloco acima, dizendo que é um link de
parceria e que qualquer outra VPS com Docker funciona igual. Depois pergunta sobre o sistema da
VPS, as portas, o domínio, o tronco SIP e a chave de IA, e acompanha até a primeira ligação.
Senha e chave não vão para a conversa: entram pelo instalador ou pela tela.

Prefere um comando a uma conversa? No seu computador (macOS ou Linux), antes de ter servidor:

```bash
curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/start.sh | bash
```

Ele só informa: o que é preciso, o tamanho da máquina, o link da parceria e o comando seguinte.
Não instala nem coleta nada.

### Ver uma chamada sem chave nem tronco

O repositório traz um motor de voz simulado. Ele roda uma chamada inteira, com saudação,
ferramenta, pedido de aprovação, transferência e tarefa pós-chamada, sem chave de IA e sem
operadora. No seu computador:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install && pnpm demo   # precisa de Docker: sobe um Postgres descartável e o remove ao sair
```

É o jeito mais rápido de entender o que o sistema faz antes de contratar qualquer coisa.

## O que ele faz hoje

O DeskVoice publica versões desde 11/11/2026, e o que muda em cada uma está no
[`CHANGELOG.md`](CHANGELOG.md). Para ninguém instalar esperando o que ainda não foi provado, cada
capacidade abaixo diz até onde a prova foi:

- **Provado em simulação:** coberto por teste de ponta a ponta com o motor simulado, que percorre a
  chamada inteira sem operadora e sem chave.
- **Provado numa instalação real:** rodou numa VPS de verdade (as de teste, em 11/11/2026, ou a
  dedicada da parceira, em 12/11/2026), do jeito e até o ponto que a linha descreve. Cada prova,
  com as saídas guardadas, está em [`docs/fundacao/instalacao-real.md`](docs/fundacao/instalacao-real.md).
- **Aguardando prova real:** implementado e testado contra servidores falsos e contra um Asterisk
  de verdade, mas ainda sem uma ligação feita por operadora real.

| Capacidade | Até onde foi provado |
|---|---|
| Conversa da chamada: saudação, falas, ferramentas, encerramento | Provado em simulação |
| Avisar um humano e pedir aprovação no meio da chamada, com prazo e resposta padrão | Provado em simulação |
| Linha do tempo de cada chamada, evento por evento, com custo | Provado em simulação |
| Tarefas depois que a ligação termina (resumo, avisos, tarefas de acompanhamento) | Provado em simulação |
| Teto de custo e de duração por chamada | Provado em simulação |
| Painel web em português, inglês e espanhol | Rotas testadas com banco real; telas conferidas em português |
| Instalar numa VPS pelo kit de instalação | Provado numa instalação real, sem domínio: Ubuntu 22.04 em duas VPS de teste e AlmaLinux 9 na VPS da parceira (lá, antes de o instalador ligar o Docker sozinho, com o serviço ligado à mão). Debian e Rocky Linux ainda sem prova |
| Painel e voz do navegador pelo mesmo endereço, a entrada única do Caddy | Provado numa instalação real, sem domínio |
| Conversar por voz com o agente pela tela "Falar com o agente" | Provado numa instalação real com o motor OpenAI Realtime, por um cliente de teste que faz o papel do navegador com fala gravada. Ainda não por um navegador com microfone |
| Painel com domínio e HTTPS | Aguardando prova real |
| Atender ligação recebida por uma linha de operadora (tronco SIP) | Aguardando prova real |
| Transferir a ligação para uma pessoa | Aguardando prova real (o caminho no Asterisk foi conferido, sem operadora) |
| Motor de voz OpenAI Realtime | Provado numa instalação real, na conversa pela tela "Falar com o agente" descrita acima. Um contribuidor fez ligações reais com ele numa instalação própria, e, com a correção do custo ([#94](https://github.com/DeskLabs-OpenSource/DeskVoice/pull/94)), a estimativa do DeskVoice bateu com a fatura da OpenAI. Essa correção está na `main` e sai na primeira versão publicada depois da 0.5.0; até lá, a estimativa da OpenAI fica acima da fatura |
| Motor de voz Gemini Live | Aguardando prova real (testado contra servidor falso, sem chave) |
| Enviar WhatsApp durante a chamada, por conector | Aguardando prova real |
| Conectar um WhatsApp por QR Code (Configurações → WhatsApp) e enviar por ele os avisos e as mensagens do agente | O serviço não vem instalado: instala-se pela tela, e custa cerca de 323 MiB de memória sem número conectado e 3,2 GB em disco (medido na 0.3.0, em 12/11/2026). Rotas testadas com banco real e com um serviço de WhatsApp falso; instalar e remover pelo agente, com Docker simulado. **Ainda sem prova com um número real:** nenhum QR Code foi lido e nenhuma mensagem saiu. É um cliente não oficial do WhatsApp; veja o [guia](docs/guides/whatsapp-por-qr-code.md) |
| Conectar o número à ligação pelo WhatsApp (Configurações → Ligação pelo WhatsApp), primeira parte da capacidade | O serviço (WaCalls) não vem instalado: instala-se pela tela; memória e disco ainda não medidos. Rotas testadas com banco real e um WaCalls falso, pelo processo de voz de verdade; instalar e remover pelo agente, com Docker simulado. **Ainda sem prova com um número real**, e nenhuma ligação é atendida ainda. Cliente não oficial do WhatsApp; veja o [guia](docs/guides/ligacao-pelo-whatsapp.md) |
| Chamar um webhook durante a chamada | Aguardando prova real (sem um receptor de verdade) |
| Atualização, checagem de saúde, backup e restauração | Provado numa instalação real, na VPS da parceira: instalador rodado duas vezes sem regerar segredo, backup conferido, restauração que devolve as contagens do backup e a volta automática de uma atualização que falhou. Restaurar em outro servidor, ou entre versões com migration nova, ainda sem prova |
| Atualizar pela tela (Configurações → Versão e atualização), por um agente do kit no servidor | Provado numa instalação real: duas vezes na VPS da parceira (0.3.0 → 0.4.0 e 0.4.0 → 0.5.0), sem ninguém no terminal do servidor, com a passagem para o atualizador da versão nova e a remoção das imagens antigas |
| Gravar o áudio da chamada, desligado de fábrica e ligado pela tela (Configurações → Gravação das chamadas) | Testado com banco real e numa chamada pelo navegador, em teste de ponta a ponta. Ainda sem prova numa instalação real. Chega a quem instala na primeira versão publicada depois da 0.5.0 |
| Prazo de guarda da transcrição e exportação do que a organização guarda sobre um telefone (Configurações) | Testado com banco real e conferido na tela, num painel contra um banco descartável. Ainda sem prova numa instalação real. Chega a quem instala na primeira versão publicada depois da 0.5.0 |
| Ligações feitas pelo agente | Aguardando prova real, e desligado de fábrica. Veja "Ligações de saída", abaixo |

Se você atender uma ligação por uma linha de operadora, conte como foi numa issue: a entrada por
tronco SIP ainda não tem registro público, e é a contribuição mais valiosa neste momento.

O que **não** existe ainda: várias empresas na mesma tela, construtor visual de fluxos, atender a
ligação pelo WhatsApp, URA por voz, filas de atendimento. Parte disso está no [roadmap](ROADMAP.md), aberta para a comunidade.

## Como funciona

```
        tronco SIP (operadora)
               │ SIP + RTP (UDP)
        ┌──────▼──────┐
        │  Asterisk   │  borda de telefonia; nunca fala com a internet por HTTP
        └──┬───────┬──┘
   ARI (WS)│       │AudioSocket (TCP, PCM16 8 kHz)
        ┌──▼───────▼──┐        ┌──────────────────┐
        │  apps/voice │◄──────►│ motor de voz     │ Gemini Live / OpenAI Realtime / simulado
        │             │        └──────────────────┘
        │  ferramentas│──► avisar humano, pedir aprovação, transferir, webhook, WhatsApp
        └──────┬──────┘
               │ eventos + tarefas
        ┌──────▼──────┐   LISTEN/NOTIFY   ┌──────────────┐
        │  Postgres   │◄─────────────────►│ apps/routines │ tarefas pós-chamada
        └──────▲──────┘                   └──────────────┘
               │
        ┌──────┴──────┐
        │  apps/panel │  Next.js: painel + API; publicado pelo Caddy
        └─────────────┘
```

Em palavras: a operadora entrega a ligação ao Asterisk. O Asterisk passa o controle e o áudio
para o processo de voz, que conversa com o modelo de IA e executa as ferramentas que o agente
pedir. Cada coisa que acontece vira um evento no Postgres, e é desses eventos que o painel
monta a linha do tempo. Quando a ligação termina, um terceiro processo continua o trabalho.

Stack: Node 22, TypeScript, pnpm, Next.js, Postgres 17 dentro da VPS, Asterisk 20, Docker
Compose e Caddy. O caminho de uma ligação, passo a passo, está em
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Relação com o DeskcommCRM

O DeskVoice é irmão do [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM), do mesmo
criador. A primeira pergunta costuma ser esta, então a resposta vai direta:

- **O DeskcommCRM já tem um módulo de ligações, e ele continua existindo.** A meta pública das
  500 estrelas foi cumprida lá.
- **O DeskVoice é um sistema independente em que a telefonia é o centro.** Você não precisa do
  Deskcomm para usar o DeskVoice, nem o contrário.
- **Mais adiante, o módulo do Deskcomm vira um conector para o DeskVoice.** Quem usa os dois
  terá a ligação e o CRM conversando. Isso é roadmap, sem data.

O motivo da separação está em
[`docs/decisions/0001-fronteira-com-o-deskcomm.md`](docs/decisions/0001-fronteira-com-o-deskcomm.md).

## Custos

O software é gratuito. Não existe versão paga nem recurso travado. Você paga três coisas, todas
direto ao fornecedor:

1. **A VPS.**
2. **A telefonia.** Depende do tronco que você contratar.
3. **A IA de voz.** Nos motores de voz direta, a estimativa fica na casa de alguns centavos de
   dólar por minuto, conforme o modelo.

São estimativas, e preços mudam. O painel mostra o custo medido de cada chamada, e cada agente
tem um teto de custo por chamada. Como estimar a sua conta está em
[`docs/guides/custos.md`](docs/guides/custos.md).

## Ligações de saída

O agente pode fazer ligações. **O recurso vem desligado.** Quem é dono da instalação liga pela
tela, depois de declarar a finalidade, e a partir daí valem:

- teto diário de chamadas por linha;
- lista de não ligar;
- janela de horário;
- limite de tentativas por pessoa;
- aviso de gravação no início da chamada.

O motivo: no Brasil, a Anatel bloqueia linhas com padrão de chamadas curtas em massa, e a
regulamentação de telemarketing está mudando. O DeskVoice não foi feito para disparo em massa
e não aceita contribuição que facilite isso. Quem opera a instalação responde pelo uso que faz
dela. Leia [`docs/guides/conformidade-brasil.md`](docs/guides/conformidade-brasil.md) antes de
ligar o recurso.

## Contatos que a instalação faz sozinha

O DeskVoice não tem telemetria: nenhum dado de uso, de chamada ou da instalação vai para o
projeto. Estes são todos os contatos com fora que a instalação faz sem você pedir:

| Quem | Com quem | Quando | O que envia |
|---|---|---|---|
| Painel | API pública de versões do GitHub (`api.github.com/repos/DeskLabs-OpenSource/DeskVoice/releases`) | Quando alguém abre Configurações ou confirma uma atualização. A resposta fica guardada por 10 minutos (1 minuto, se a consulta falhou) | Um pedido de leitura sem credencial e sem corpo, com dois cabeçalhos fixos, iguais em toda instalação: `accept: application/vnd.github+json` e `user-agent: deskvoice-panel`. Nenhuma versão, endereço ou identificador da instalação |
| Agente de atualização | O repositório no GitHub, por `git fetch --tags` | O agente passa a cada minuto e busca as versões no máximo a cada 10 minutos, quando a instalação está numa versão publicada e veio de um clone do repositório | O pedido do git para buscar as etiquetas, sem credencial. O git se identifica com a própria versão (`git/2.x`); nada da instalação vai junto |
| Caddy, só com domínio | A autoridade de certificados que o Caddy usa (Let's Encrypt, por padrão) | Ao instalar e, depois, sozinho, para renovar o certificado antes de vencer | O domínio, para provar que ele aponta para a VPS. O DeskVoice não configura e-mail nesse pedido |

Quando você pede, a instalação também fala com fora:

- **Instalar e atualizar** (pelo terminal ou pela tela) baixa o código do GitHub e as imagens: as do
  DeskVoice no `ghcr.io` (painel, voz e rotinas) e as de terceiros no Docker Hub (Postgres, Caddy,
  Asterisk). O Docker se identifica como em qualquer download de imagem (versão dele, do kernel e
  a arquitetura); o DeskVoice não acrescenta nada.
- **Instalar sem informar o IP** (`DESKVOICE_PUBLIC_IP`): o instalador descobre o IP público da VPS
  perguntando a `api.ipify.org`, `ifconfig.me` e `icanhazip.com`, um de cada vez, até um responder.
  O pedido não leva nada; o serviço vê o IP da VPS, que é a resposta. O `install/diagnose.sh` faz
  a mesma consulta.
- **Instalar sem Docker:** depois de perguntar, o instalador baixa o script oficial de
  `get.docker.com`.
- **Instalar o WhatsApp pela tela:** o agente baixa a imagem do WAHA do Docker Hub, e tenta de novo
  a cada 10 minutos se o download falhar.
- **Construir na própria máquina** (`--build`): baixa a base do Node do Docker Hub, o pnpm e os
  pacotes do registro do npm.

No uso, o DeskVoice fala com o que você configurou: o provedor de IA de voz (Google ou OpenAI)
durante as chamadas, com a sua chave; a operadora do tronco SIP; o WhatsApp, pelo WAHA, se você o
conectou; e os endereços das ferramentas e webhooks que você cadastrou.

## Contribuir

O projeto foi montado para que um PR de primeira viagem dê certo:

- Abra o repositório no seu assistente de código (Claude Code, Codex, Cursor, Antigravity). As
  skills em `.agents/skills/` guiam a contribuição, e o [`AGENTS.md`](AGENTS.md) é a autoridade
  que todos eles leem.
- Ferramenta, motor de voz e rotina moram cada um no próprio arquivo e são descobertos pela
  pasta. Seu PR não disputa uma lista central com o PR de outra pessoa.
- Quando o CI fica vermelho, ele diz se a causa é do seu PR.

Comece por [`CONTRIBUTING.md`](CONTRIBUTING.md). Para uma primeira contribuição com começo, meio
e fim: [adicionar uma ferramenta](docs/guides/adicionar-uma-ferramenta.md) ou
[adicionar um motor de voz](docs/guides/adicionar-um-motor-de-voz.md).

## Roadmap

O horizonte e as frentes abertas para a comunidade, cada uma com tamanho e ponto de entrada no
código, estão em [`ROADMAP.md`](ROADMAP.md). Entre as frentes: motor de voz em pipeline
(transcrição, modelo de texto e síntese), ferramentas de agenda, CRM e pagamento, conector com o
DeskcommCRM e painel de supervisão ao vivo.

## Quem constrói

O DeskVoice foi criado por Rafael Melgaço ([@melgarafael](https://www.youtube.com/@melgarafael)) e
é construído em público, com a comunidade. Já há contribuições de fora: as cercas e a
segurança de [webtecnica](https://github.com/webtecnica) estão nas versões publicadas. Estão na `main` e saem na próxima
versão os direitos de quem ligou (prazo de guarda e exportação), também de webtecnica, e o custo da
OpenAI conferido contra a fatura, a despedida antes de desligar e a gravação das chamadas, de
[aliffstefano](https://github.com/aliffstefano). O DeskcommCRM, de onde vem a fábrica de contribuição
usada aqui, recebeu PRs de mais de 250 pessoas.

Crédito é regra, não cortesia: quem contribui mantém a autoria do commit e tem o nome nas notas
da versão. O que este projeto deve a outros projetos está em [`CREDITS.md`](CREDITS.md). Quem
decide o quê está em [`GOVERNANCE.md`](GOVERNANCE.md).

Quer ganhar dinheiro instalando e mantendo o DeskVoice para empresas? Pode, e não nos deve nada
por isso. Veja [`docs/guides/ganhar-dinheiro-implementando.md`](docs/guides/ganhar-dinheiro-implementando.md).

## Licença

[MIT](LICENSE). © 2026 Rafael Melgaço e contribuidores.

O Asterisk, usado como serviço à parte na borda de telefonia, é distribuído pelos seus autores
sob GPLv2 e não é embutido no código do DeskVoice.

## Suporte e responsabilidades

- **Dúvida ou ideia:** [GitHub Discussions](https://github.com/DeskLabs-OpenSource/DeskVoice/discussions).
- **Bug:** [abra uma issue](https://github.com/DeskLabs-OpenSource/DeskVoice/issues).
- **Vulnerabilidade:** relato privado, como descrito em [`SECURITY.md`](SECURITY.md). Nunca em issue pública.

O que é seu, por ser uma instalação própria:

- **A VPS e os dados.** Firewall, atualizações do sistema e backup fora da máquina são com você.
  O instalador traz backup e restauração, mas não escolhe por você onde guardar a cópia.
- **As chaves e os contratos.** A conta com o provedor de IA e com a operadora é sua, e a fatura
  também.
- **O uso.** Gravação, tratamento de dados pessoais e ligações de saída têm regras legais. O
  projeto entrega os controles, e não oferece aconselhamento jurídico.

O software é entregue como está, sem garantia, nos termos da licença MIT.

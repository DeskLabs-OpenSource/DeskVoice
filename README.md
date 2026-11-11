<div align="center">

Português · [English](README.en.md) · [Español](README.es.md)

# DeskVoice

**Central telefônica open source operada por agentes de IA, instalada na sua VPS.**

O agente atende a ligação, executa ferramentas durante a conversa, pede aprovação a um humano
quando precisa, transfere e deixa tarefas rodando depois que a chamada termina.

[![CI](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml/badge.svg)](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-green)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Instalação própria](https://img.shields.io/badge/instala%C3%A7%C3%A3o-na%20sua%20VPS-orange)](install/install.sh)

[Visão](VISION.md) · [Arquitetura](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Contribuir](CONTRIBUTING.md) · [Primeira ligação](docs/guides/primeira-ligacao.md)

</div>

---

> **Estado do projeto: fundação em construção.** O que está pronto, o que é experimental e o que
> ainda é plano estão separados na seção "O que ele faz hoje". Não há data
> prometida para nada do roadmap.

## Instalar

### Na sua VPS

Entre na VPS por SSH e rode:

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
| Uma VPS Ubuntu 22.04 ou mais nova | Recomendamos a [HostGator](https://www.hostgator.com.br/52708-141-3-52.html), parceira de infraestrutura do projeto (link de parceria). Qualquer VPS com Docker serve, pelo mesmo comando. O recomendado é 2 GB de memória ou mais |
| Um domínio apontado para a VPS | Opcional para testar. Sem domínio, o painel abre pelo IP e sem HTTPS |
| Um tronco SIP com um número | Contratado com a operadora de telefonia de sua escolha. Autenticação por registro ou por IP |
| Uma chave de IA de voz | Gemini (Google) ou OpenAI. Você paga o uso direto ao provedor |

O passo a passo completo, do zero à primeira chamada, está em
[`docs/guides/primeira-ligacao.md`](docs/guides/primeira-ligacao.md).

### Ver uma chamada sem chave nem tronco

O repositório traz um motor de voz simulado. Ele roda uma chamada inteira, com saudação,
ferramenta, pedido de aprovação, transferência e tarefa pós-chamada, sem chave de IA e sem
operadora. No seu computador:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install && pnpm demo
```

É o jeito mais rápido de entender o que o sistema faz antes de contratar qualquer coisa.

## O que ele faz hoje

**Pronto** quer dizer: implementado e coberto por teste de ponta a ponta com o motor simulado.
**Experimental** quer dizer: implementado, com pouca quilometragem em operadora e tronco reais.

| Capacidade | Estado |
|---|---|
| Atender ligação recebida com um agente configurado no painel | Pronto |
| Executar ferramentas durante a chamada (webhook, tarefa, encerrar) | Pronto |
| Avisar um humano e pedir aprovação no meio da chamada, com prazo e resposta padrão se ninguém decidir | Pronto |
| Transferir a ligação para uma pessoa | Pronto |
| Linha do tempo de cada chamada, evento por evento, com custo | Pronto |
| Tarefas depois que a ligação termina (resumo, aviso, webhook) | Pronto |
| Teto de custo e de duração por chamada | Pronto |
| Painel web em português, inglês e espanhol | Pronto |
| Instalador, atualização, checagem de saúde, backup e restauração | Pronto |
| Motor simulado para testes e demonstração | Pronto |
| Motores de voz direta Gemini Live e OpenAI Realtime | Experimental |
| Enviar WhatsApp durante a chamada, por conector (DeskcommCRM ou webhook) | Experimental |
| Ligações feitas pelo agente | Experimental e desligado de fábrica. Veja "Ligações de saída", abaixo |

O que **não** existe ainda: gravação de áudio (a fundação guarda a transcrição), várias empresas
na mesma tela, construtor visual de fluxos, ligação pelo WhatsApp, URA por voz, filas de
atendimento. Parte disso está no [roadmap](ROADMAP.md), aberta para a comunidade.

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
DeskcommCRM, gravação com retenção configurável e painel de supervisão ao vivo.

## Quem constrói

O DeskVoice foi criado por Rafael Melgaço ([@melgarafael](https://www.youtube.com/@melgarafael)) e
é construído em público, com a comunidade. O DeskcommCRM, de onde vem a fábrica de contribuição
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

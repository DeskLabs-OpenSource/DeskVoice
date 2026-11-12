# Créditos

O DeskVoice não nasceu do zero. Este arquivo existe desde o primeiro commit para dizer o que
veio de onde. Se você encontrar aqui uma omissão ou um erro, abra uma issue: corrigir crédito
tem prioridade.

## Código e conhecimento trazidos de outro projeto

### DeskcommCRM

Repositório: <https://github.com/melgarafael/DeskcommCRM>. Licença MIT.

Do módulo de voz do DeskcommCRM vieram:

- **A ponte AudioSocket.** A implementação do protocolo que leva o áudio do Asterisk até o
  processo de voz foi portada de lá.
- **As lições de NAT e RTP.** O que o instalador confere sobre endereço público, endereço da
  interface e faixa de portas de áudio é conhecimento pago com instalações reais do Deskcomm.

Do uso do WAHA no DeskcommCRM vieram, como lição e não como código:

- **O que o WhatsApp por QR Code precisa para não quebrar em silêncio.** O nome certo da variável
  do motor (com o errado, o WAHA cai no motor com navegador), a imagem fixada em vez de etiqueta
  móvel, a chave entregue ao contêiner só como hash, o teto de memória, ler a configuração da
  sessão antes de regravá-la (a escrita substitui tudo), sair antes de iniciar quando a sessão
  falhou e conferir o endereço do número antes de enviar. O cliente do DeskVoice
  (`packages/tools/src/connectors/waha.ts`) foi escrito do zero a partir da documentação do WAHA.

Da fábrica do DeskcommCRM vieram a contribuição guiada por skills, o lançamento por fragmentos,
a forma do instalador e as doutrinas de sistema vivo, versionamento e ação destrutiva, aqui
reescritas para telefonia.

O DeskcommCRM é obra de mais de 250 autores de PR. Parte do que está aqui é trabalho deles.

## Software usado como serviço à parte

Estes programas rodam ao lado do DeskVoice, em contêineres próprios. O código deles não é
embutido nem modificado.

| Projeto | Papel no DeskVoice | Licença |
|---|---|---|
| [Asterisk](https://www.asterisk.org) | Borda de telefonia: fala SIP e RTP com a operadora e entrega o áudio por AudioSocket | GPLv2 |
| [PostgreSQL](https://www.postgresql.org) | Banco de dados e fila | PostgreSQL License |
| [Caddy](https://caddyserver.com) | Publica o painel com HTTPS | Apache 2.0 |
| [WAHA](https://github.com/devlikeapro/waha) | Mantém a sessão do WhatsApp conectado por QR Code e envia as mensagens. Cliente não oficial do WhatsApp | Apache 2.0 |

Sobre o WAHA: a imagem publicada pelos autores (`devlikeapro/waha`) é referenciada pelo Compose,
com versão e resumo fixos, e nunca republicada. O DeskVoice fala com ele pela API HTTP. O WAHA
não é afiliado ao WhatsApp nem à Meta, e o DeskVoice não é afiliado ao WAHA.

Sobre o Asterisk: o DeskVoice conversa com ele por interfaces de rede (ARI e AudioSocket) e não
contém código do Asterisk. O Asterisk continua sob a licença dele, e o DeskVoice sob MIT. O
protocolo AudioSocket faz parte do Asterisk e é obra dos seus autores.

## Bibliotecas

O DeskVoice é construído sobre [Node.js](https://nodejs.org),
[TypeScript](https://www.typescriptlang.org), [pnpm](https://pnpm.io),
[Next.js](https://nextjs.org) e [React](https://react.dev), entre outras. A lista completa, com
versões, é o que está declarado nos arquivos `package.json` do repositório, e cada biblioteca
segue sob a licença dos seus autores.

## Fontes do painel

O painel usa [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/), do Braille
Institute, e [IBM Plex Mono](https://github.com/IBM/plex), da IBM, as duas sob a SIL Open Font
License 1.1. Os arquivos ficam em `apps/panel/src/app/fonts/`, com a licença de cada uma ao lado.
São o subconjunto latino publicado pelo [Fontsource](https://fontsource.org) 5.3.0, sem alteração.

## Provedores de IA

Os motores de voz direta usam as interfaces Gemini Live, do Google, e Realtime, da OpenAI.
São serviços de terceiros, contratados por quem instala, com termos próprios. O DeskVoice não
é afiliado a esses provedores.

## Parceria

A HostGator é a parceira de infraestrutura do projeto.

## Marca

O nome na marca é composto em [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/),
do Braille Institute, sob a SIL Open Font License 1.1, e está convertido em curvas nos arquivos de
[`brand/`](brand/README.md). É a mesma fonte do painel.

## Pessoas

Quem contribui com o DeskVoice mantém a autoria do que escreveu e é nomeado nas notas de cada
versão. A regra está em [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Como dar crédito num PR

Trouxe código, trecho de configuração ou ideia de outro projeto? Diga no PR de onde veio e sob
qual licença, e acrescente uma linha neste arquivo. Código sem origem declarada não entra.

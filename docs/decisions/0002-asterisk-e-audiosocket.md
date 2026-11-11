# 0002: Asterisk na borda, áudio por AudioSocket

- **Estado:** aceita
- **Data:** 2026-11-10
- **Quem decidiu:** dono do projeto

## Contexto

Uma central com agentes de IA precisa de duas coisas na borda: falar com a operadora (SIP para
a sinalização, RTP para o áudio) e entregar esse áudio, em tempo real, a um processo que
conversa com o modelo de voz.

Três restrições pesaram:

- **Troncos brasileiros.** Muitos troncos nacionais autenticam por registro: é a central que se
  registra na operadora (REGISTER), e não a operadora que envia a chamada para um endereço fixo.
- **Uma linguagem.** O projeto é Node e TypeScript de ponta a ponta. Cada linguagem a mais
  reduz o número de pessoas capazes de contribuir com o todo.
- **Uma VPS pequena.** Cada serviço a mais é mais memória, mais uma coisa para instalar e mais
  uma coisa para dar errado.

## Decisão

**Asterisk 20** fica na borda de telefonia. Ele fala SIP e RTP com a operadora, é comandado
pelo processo de voz pela interface ARI e entrega o áudio por **AudioSocket**: uma conexão TCP
simples, com PCM16 mono a 8 kHz.

Os modelos de voz ficam atrás de uma interface única (`VoiceEngine`). O áudio entre a ponte e o
motor é sempre o mesmo formato, e cada motor converte para o que o provedor pede.

A ponte AudioSocket já estava provada no DeskcommCRM e foi portada de lá.

## Alternativas descartadas

### LiveKit

Servidor de mídia em tempo real, com suporte a SIP e um ecossistema de agentes de voz.

- **Não aceita tronco com REGISTER**, que é como muitos troncos nacionais autenticam. Para o
  público do projeto, isso exclui a operadora antes de a conversa começar.
- **O SDK de Node está atrás do de Python.** O caminho bem cuidado para agentes passa por
  Python.
- **É mais um servidor de mídia** para instalar, configurar e manter na VPS.

### Pipecat

Framework para agentes de voz em tempo real.

- **É Python.** Seria a segunda linguagem do projeto.
- **Não tem SIP próprio.** Ainda seria preciso uma borda de telefonia. A pergunta "quem fala
  com a operadora?" continuaria aberta.

### Receber mídia direto no Node, sem central

- Significaria reimplementar o que o Asterisk faz há décadas: registro em tronco, negociação de
  codec, travessia de NAT, transferência. Não é o trabalho que este projeto existe para fazer.

## Consequências

**Boas:**

- Tronco por registro e tronco por IP funcionam.
- O protocolo de áudio é pequeno e legível. Um contribuidor entende a ponte em uma leitura.
- Transferência, DTMF e desligamento são capacidades da central, já resolvidas.
- Trocar ou acrescentar modelo de voz é escrever um arquivo, sem tocar na telefonia.

**Custos:**

- **Áudio de telefonia, 8 kHz.** É o que a rede telefônica entrega. Os motores convertem, e a
  conversão custa um pouco de processamento.
- **Configuração do Asterisk.** É conhecida por ser árida. O projeto assume esse custo: a tela
  de linha telefônica gera a configuração, e o operador não a edita.
- **NAT e RTP continuam sendo a parte difícil** de qualquer instalação de voz. O instalador
  confere o que consegue conferir.
- **Licença.** O Asterisk é GPLv2. Ele roda como serviço à parte, em contêiner próprio, e o
  DeskVoice fala com ele pela rede. Nenhum código do Asterisk é embutido. Veja
  [`CREDITS.md`](../../CREDITS.md).
- **A interface de controle (ARI) é poderosa.** Por isso nunca é publicada para fora da rede
  interna. Veja [`SECURITY.md`](../../SECURITY.md).

**Quando rever:** se uma das alternativas passar a aceitar tronco por registro e a ter um
caminho de primeira classe em Node, vale reabrir a comparação.

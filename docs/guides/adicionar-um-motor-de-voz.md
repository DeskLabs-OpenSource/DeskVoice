# Adicionar um motor de voz

Um motor de voz é a peça que liga a chamada a um modelo de IA: recebe o áudio de quem ligou,
devolve a fala do agente e avisa quando o modelo quer usar uma ferramenta. Este guia mostra como
escrever um.

A fundação traz três: `simulated`, `gemini-live` e `openai-realtime`. Um motor novo é **um
arquivo** em `packages/voice-engine/src/engines/`, descoberto pela pasta.

> Usa um assistente de código? A skill `deskvoice-motor-de-voz` carrega este roteiro.

## Dois tipos de motor

| Tipo | Como funciona | Estado |
|---|---|---|
| Voz direta | Um único modelo ouve e fala. É o caso do Gemini Live e do OpenAI Realtime | Existe |
| Pipeline | Três etapas: transcrição (STT), modelo de texto (LLM) e síntese de voz (TTS) | Frente aberta no [`ROADMAP.md`](../../ROADMAP.md) |

A interface é a mesma para os dois. Um motor em pipeline é um motor que, por dentro, coordena
três serviços e os apresenta como uma sessão só. É um trabalho maior: converse numa issue antes
de começar.

## O contrato

```ts
interface VoiceEngine {
  id: string;            // identificador gravado no agente e na chamada
  label: string;         // nome mostrado na tela
  pricing: EnginePricing;
  connect(config: VoiceSessionConfig, apiKey: string): Promise<VoiceSession>;
}

interface VoiceSessionConfig {
  instructions: string;
  greeting?: string;     // quando presente, o agente fala primeiro
  voiceId?: string;
  language: string;      // BCP 47, por exemplo "pt-BR"
  tools: ToolSpec[];     // nome, descrição e parâmetros em JSON Schema
}

interface VoiceSession {
  on(event, handler): void;
  sendAudio(pcm16_8k: Buffer): void;               // áudio de quem ligou
  sendToolResult(id: string, result: unknown): void;
  say(text: string): void;                         // pede uma fala com este conteúdo
  close(): Promise<void>;
}
```

Os eventos que a sessão emite:

| Evento | Quando | O que o resto do sistema faz |
|---|---|---|
| `audio` | O agente falou um trecho | Envia o áudio para quem ligou |
| `transcript` | Um turno de fala foi transcrito, de quem ligou ou do agente | Grava na linha do tempo |
| `toolCall` | O modelo pediu uma ferramenta | Valida, executa e devolve com `sendToolResult` |
| `interrupted` | Quem ligou falou por cima do agente | Descarta o áudio que ainda não saiu |
| `usage` | O provedor informou uso: segundos, tokens | Mede o custo |
| `error` | Algo falhou | Registra |
| `closed` | A sessão terminou, com o motivo | Encerra ou trata a falha |

Leia as interfaces no próprio pacote antes de começar. Elas são a fonte, e este guia é o
resumo.

## A regra do áudio

> **Entre a ponte e o motor, o áudio é sempre PCM16 mono a 8 kHz. Nos dois sentidos.**

É o formato da rede telefônica. O que o provedor pede é problema do motor:

- o áudio que chega em `sendAudio` vem em 8 kHz. Se o provedor quer 16 ou 24 kHz, converta
  antes de enviar;
- o áudio que o provedor devolve precisa sair no evento `audio` em 8 kHz. Converta antes de
  emitir.

O pacote traz a função `resample` para isso. Não escreva outra.

O evento `audio` aceita pedaços de qualquer tamanho. Dividir em quadros para a telefonia é
trabalho da ponte.

## O que um motor precisa fazer bem

### 1. Abrir a sessão, ou falhar com clareza

`connect` devolve uma sessão pronta ou lança um erro que diga o que houve: chave inválida,
modelo inexistente, limite atingido. É essa mensagem que permite ao sistema recusar a chamada
com motivo, em vez de atender e ficar mudo.

### 2. Falar primeiro, quando há saudação

Se `greeting` veio preenchido, o agente abre a conversa. Quem liga e ouve silêncio desliga.

### 3. Dizer exatamente o que `say` pede

`say` é usado para falas que não podem ser reinterpretadas: o aviso de gravação, o pedido de
desculpa quando algo falha, o "um instante" de uma ferramenta. O motor deve produzir uma fala
com aquele conteúdo, e não uma resposta criativa sobre ele.

### 4. Tratar a interrupção

Quando quem ligou fala por cima, o motor emite `interrupted`. Sem isso, o agente continua
falando sozinho por cima da pessoa, e a conversa fica impossível.

### 5. Passar as ferramentas e devolver os resultados

As ferramentas chegam em `tools`, já em JSON Schema. O motor as traduz para o formato do
provedor. Quando o modelo pede uma, o motor emite `toolCall` com um identificador, e recebe a
resposta por `sendToolResult` com o mesmo identificador.

### 6. Informar o uso

Sem o evento `usage`, a chamada não tem custo medido e o teto de custo não funciona. Um motor
que não informa uso não está pronto.

### 7. Fechar sempre avisando

Toda sessão termina com `closed` e um motivo, inclusive quando o provedor derruba a conexão. É
esse evento que faz o sistema falar o pedido de desculpa, transferir ou encerrar, e registrar a
falha na linha do tempo. Um motor que morre calado deixa a ligação muda, que é o defeito que
este projeto mais quer evitar.

## Preço

Cada motor declara a própria tabela de preço em `pricing`. O sistema usa essa tabela e o uso
informado para estimar o custo da chamada.

- Use o preço público do provedor, e diga no PR a fonte e a data em que consultou.
- Preço muda. Deixe um comentário no arquivo com a data da última conferência.
- Não invente número. Se o provedor não publica preço para o modelo, diga isso no PR.

## O teste de contrato

Nenhum teste do repositório fala com um provedor de verdade. O motor é testado contra um
**servidor falso**, aberto na porta `0`, que imita o protocolo do provedor. O teste cobre, no
mínimo, cinco situações:

1. **Abertura de sessão:** o motor envia a configuração que o provedor espera.
2. **Envio de áudio:** o áudio de quem ligou chega ao servidor no formato certo.
3. **Fala recebida:** o áudio que o servidor devolve sai no evento `audio`, em 8 kHz.
4. **Chamada de ferramenta:** o pedido vira `toolCall`, e o resultado volta ao servidor.
5. **Fechamento inesperado:** o servidor derruba a conexão, e o motor emite `closed` com
   motivo.

Os testes de `gemini-live` e `openai-realtime` são o modelo a seguir.

O teste não usa relógio real nem porta fixa.

## Implemente contra a documentação atual

As interfaces de voz em tempo real dos provedores mudam com frequência. Implemente contra a
documentação oficial **do dia em que você escreve**, e não contra um exemplo antigo, um artigo
ou a memória de um assistente de código. Diga no PR o endereço e a data da documentação que
você seguiu.

## Antes de abrir o PR

```bash
pnpm verify
```

E a lista do que o CI não vê:

- [ ] Testei com uma chave real e uma ligação real, ou digo no PR que não testei.
- [ ] O agente fala primeiro quando há saudação.
- [ ] Interromper o agente funciona.
- [ ] `say` produz a fala pedida.
- [ ] O custo aparece na linha do tempo e bate, aproximadamente, com o painel do provedor.
- [ ] Derrubar a conexão no meio da chamada resulta em pedido de desculpa e em registro da
      falha, e não em silêncio.
- [ ] O português do Brasil soa natural. Diga no PR com que voz testou.
- [ ] A fonte e a data do preço estão no PR.

Um motor novo entra como experimental. Ele deixa de ser depois de quilometragem em chamadas
reais.

## Chave do provedor

A chave é informada pelo operador na tela e guardada cifrada. O motor a recebe em `connect`. Um
motor novo não cria variável de ambiente e não lê chave de outro lugar.

Se o provedor precisa de mais do que uma chave (uma região, um identificador de projeto), isso é
configuração com tela. Diga no PR o que o operador precisa informar.

## Documentos relacionados

- [Decisão 0002](../decisions/0002-asterisk-e-audiosocket.md): por que o áudio é este e a
  interface é uma só.
- [`um-arquivo-por-peca.md`](../doctrine/um-arquivo-por-peca.md): por que não há lista de
  motores.
- [Custos](custos.md): como o uso vira valor.

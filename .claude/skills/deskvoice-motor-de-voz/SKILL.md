---
name: deskvoice-motor-de-voz
description: 'Como adicionar ou alterar um motor de voz no DeskVoice (o provedor de IA que ouve e fala na ligação: Gemini Live, OpenAI Realtime, o simulado, ou um novo). Use quando a pessoa pedir "suportar o provedor X", "adicionar um modelo de voz", "trocar a voz", "pipeline STT + LLM + TTS", ou for mexer em packages/voice-engine. Cobre: um arquivo em packages/voice-engine/src/engines/, a interface VoiceEngine, áudio PCM16 8 kHz na borda, teste de contrato com servidor falso e preço com data e fonte.'
---

# Adicionar um motor de voz

Um motor é **um arquivo** em `packages/voice-engine/src/engines/`, que exporta um `VoiceEngine`
como `default`. `loadEngines()` descobre pela pasta e **falha alto** se o export não for um motor
ou se o `id` repetir. Não há lista para editar.

## 1. O contrato (`packages/voice-engine/src/types.ts`)

```ts
interface VoiceEngine {
  id: string;            // "gemini-live": é o valor gravado em agents.engine
  label: string;         // nome mostrado no painel
  keyless?: boolean;     // true só para motor que não precisa de chave (o simulado)
  pricing: EnginePricing;
  connect(config: VoiceSessionConfig, apiKey: string): Promise<VoiceSession>;
}
interface VoiceSessionConfig { instructions: string; greeting?: string; voiceId?: string; language: string; tools: ToolSpec[] }
interface VoiceSession {
  on<K extends keyof VoiceSessionEvents>(event: K, handler: VoiceSessionEvents[K]): void;
  sendAudio(pcm16_8k: Buffer): void;                  // áudio de quem ligou
  sendToolResult(id: string, result: unknown): void;
  say(text: string): void;                            // fala pedida pelo sistema (aviso de gravação, desculpa)
  close(): Promise<void>;
}
interface VoiceSessionEvents {
  audio(pcm16_8k: Buffer): void;                      // fala do agente
  transcript(turn: { speaker: "user" | "agent"; text: string }): void;
  toolCall(call: { id: string; name: string; args: unknown }): void;
  interrupted(): void;                                // a pessoa falou por cima
  usage(usage: Usage): void;
  error(error: Error): void;
  closed(reason: string): void;
}
```

Confira no arquivo antes de escrever: se este resumo divergir, vale o arquivo.

## 2. As regras que não são negociáveis

- **Áudio na borda é sempre PCM16 mono 8 kHz**, nos dois sentidos. É o que o Asterisk entrega
  pelo AudioSocket. O que o provedor pede (16 kHz, 24 kHz, outro formato) é assunto interno do
  motor: converta com `resample(pcm16, fromHz, toHz)`, de `../resample`. Nunca empurre a
  conversão para quem chama.
- **`connect` só resolve com a sessão pronta** para receber áudio. Chave inválida ou conexão
  recusada **rejeita** o `connect`: é o que permite recusar a chamada com motivo em vez de
  atender mudo.
- **Queda no meio vira `error` seguido de `closed`.** Nunca silêncio: `apps/voice` depende disso
  para falar a desculpa, transferir ou encerrar, e registrar `engine_failed`.
- **`close()` é idempotente** e não emite `error`.
- **`greeting` presente: o agente fala primeiro.**
- **`interrupted`** quando a pessoa fala por cima: quem toca o áudio descarta o que ainda não saiu.
- **`usage` é emitido**: sem ele a chamada não tem custo, e o teto por chamada não funciona.
- **Mensagem do provedor é entrada externa**: valide com zod. Mensagem fora do formato é ignorada
  sem derrubar a sessão.
- **A chave vem por parâmetro** (`apiKey`). O motor não lê variável de ambiente nem banco.
- **Nada olha o relógio.**

Para WebSocket, reutilize o que já existe: `SessionEmitter` (`../emitter`) entrega os eventos, e
`openProviderSocket` (`../provider-socket`) abre a conexão e já garante o contrato de fechamento.

## 3. Passo a passo

1. Leia um motor vizinho inteiro, com o teste: `engines/openai-realtime.ts` ou
   `engines/gemini-live.ts`. O `simulated.ts` mostra o contrato sem rede.
2. Abra a **documentação oficial atual** do provedor e escreva contra ela. No comentário de topo
   do arquivo, liste as páginas consultadas e **o que você não confirmou contra o servidor real**.
   Não escreva protocolo de memória.
3. Crie `packages/voice-engine/src/engines/<id>.ts` com `export default`.
4. Mapeie: `instructions`, `voiceId`, `language` e `tools` na abertura da sessão; áudio de entrada
   e de saída com a conversão; chamada de ferramenta em `toolCall`, e `sendToolResult` de volta
   com o mesmo `id`; transcrição por turno; consumo em `usage`.
5. Preencha o preço (abaixo).
6. Escreva o teste de contrato (abaixo).

## 4. Preço, com data e fonte

```ts
pricing: {
  centsPerMinute?: number,               // provedor que cobra por tempo
  centsPerMillionInputTokens?: number,   // provedor que cobra por token de áudio
  centsPerMillionOutputTokens?: number,
  checkedOn: "AAAA-MM-DD",               // o dia em que VOCÊ abriu a página de preços
  source: "https://...",                 // a página
}
```

Centavos de dólar. Preço de provedor muda: `checkedOn` e `source` são obrigatórios, e o valor é o
que você leu na página nesse dia, não o que lembra. Na dúvida entre dois valores, use o maior:
superestimar um pouco é aceitável, subestimar fura o teto de custo de alguém.
`estimateCostCents(pricing, usage)` faz a conta.

## 5. Teste de contrato com servidor falso (`<id>.test.ts`, ao lado)

Um servidor WebSocket de mentira **na porta `0`**, que fala o protocolo do provedor. Nenhuma
chamada à internet, nenhuma chave real. Cubra, como os vizinhos:

1. abertura da sessão: chave, modelo, voz, instruções e ferramentas chegam como o provedor espera;
2. `connect` só resolve depois da confirmação do servidor; com `greeting`, o agente fala primeiro;
3. áudio de quem ligou sai convertido para a taxa do provedor;
4. fala recebida vira `audio` em 8 kHz; transcrição sai por turno;
5. chamada de ferramenta vira `toolCall`, e o resultado volta com o `id`;
6. interrupção vira `interrupted`;
7. mensagem fora do formato é ignorada;
8. queda do socket vira `error` seguido de `closed`;
9. `close()` duas vezes não gera erro;
10. conexão recusada rejeita o `connect`.

```bash
pnpm vitest run --project unit packages/voice-engine
pnpm vitest run --project unit apps/voice     # a chamada simulada continua inteira
pnpm verify
```

Prove por sabotagem: comente a conversão de taxa ou o tratamento de queda, veja cair, restaure.

## 6. O que o teste não prova, e você diz no PR

O servidor falso prova o seu entendimento do protocolo, não o provedor. No PR, declare: testou
com chave real? Quantas ligações, em que idioma? Como soou em pt-BR, e qual foi a demora até a
primeira fala? Se não testou com chave real, diga. Um mantenedor testa antes do merge.

## 7. Antes do PR

- [ ] O PR toca só o arquivo do motor e o teste.
- [ ] Preço com `checkedOn` e `source`.
- [ ] Comentário de topo com as páginas consultadas e o que não foi confirmado.
- [ ] Código de terceiros adaptado? Crédito no [`CREDITS.md`](../../../CREDITS.md).
- [ ] Fragmento em `.changes/` (`impact: new_capability`, `section: added`).

O caminho do PR é a skill `deskvoice-contribuir`.

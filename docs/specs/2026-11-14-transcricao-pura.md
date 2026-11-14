# Transcrição pura: o agente entende exatamente o que a pessoa falou

> Roteiro de novembro, item R12 (DESA-25). Desenho do Arquiteto, 14/11/2026.
> Fala do Rafael em 13/11: "fazer com que a inteligência artificial entenda da forma mais pura
> possível o que a pessoa falou". E sobre o ditado do computador: "Eu quero essa pureza no DeskVoice."
> Este desenho cruza o caminho do áudio do ouvido (#160, R3, DESA-10) e do ambiente barulhento
> (#182, R11, DESA-24). Os pontos de contato estão em "Onde esta frente toca as outras".

## Problema

Hoje o texto da fala de quem ligou sai de um reconhecedor que o provedor do motor escolhe
(`gpt-4o-mini-transcribe` no OpenAI Realtime, `inputAudioTranscription` no Gemini Live), num áudio
que passou por uma ponte de 8 kHz (`apps/voice/src/transport.ts`, `SAMPLE_RATE = 8000`). Ninguém
mediu se esse reconhecedor é o que melhor ouve português do Brasil, nomes próprios, sotaque, fala
atípica e fundo barulhento. Ninguém mediu quanto a ponte de 8 kHz custa em acerto para o WhatsApp
e o navegador, que chegam em banda larga.

O caso que motivou: um usuário surdo, com a fala prejudicada, que a IA não consegue transcrever.

O pedido tem três partes, e a ordem importa:

1. **Medir antes de escolher.** Nenhum transcritor é trocado sem medida.
2. **Uma peça de transcrição em streaming** no `packages/voice-engine`, com o vencedor da medida,
   que o motor em pipeline (R5, DESA-13) usa.
3. **Jev e Laya como filtro sobre o texto**, em paralelo com a transcrição parcial. Eles não
   escrevem nem ouvem: só decidem (escolha, nota, sim ou não). São o meio. O fim é a pureza.

## O que o código faz hoje (lido em `origin/main` `28fc22b`, 14/11)

- `VoiceSessionEvents.transcript` entrega a fala de quem ligou **só quando o turno fecha**. Não há
  texto parcial no contrato. A DESA-24 (fatia 1, DESA-26) acrescenta `callerActivity`, que diz que
  chegou texto novo, mas não entrega o texto.
- O áudio de quem ligou vai direto ao motor (`transport.onAudio` → `session.sendAudio`), sempre
  PCM16 mono 8 kHz. Não há nenhuma derivação dele para um segundo consumidor.
- `RecordingTranscriber` (`packages/voice-engine/src/types.ts`, `transcription.ts`) transcreve a
  gravação **depois** da chamada, pelo motor do agente. Não é streaming, e não é o assunto aqui,
  mas a peça nova pode servir a ele depois (ver "Fora do escopo").
- Não existe nenhuma chamada a modelo de decisão no DeskVoice.

## Parte 1: a medida

### O conjunto de teste

Um manifesto versionado em `scripts/bancada-de-voz/conjunto/pt-br.json`, só com **texto**: a frase,
os termos que ela precisa acertar e as marcas do caso. O áudio é gerado na hora da medida, numa
pasta temporária fora do repositório, e **nunca** é versionado.

| Caso | Exemplos de frase (inventados) | O que mede |
|---|---|---|
| Nomes próprios | "Aqui é o Rafael Melgaço", "Falo com a Doutora Iracema Tupinambá?" | acerto do nome, letra por letra |
| Empresas e produtos | "Sou cliente da DeskVoice", "comprei pela Magazine Ipiranga" | acerto do termo |
| Números | "meu CPF termina em quatro sete dois", "o pedido é o 10.348", "às três e quinze" | acerto do número, normalizado |
| Lugares | "moro em Itaquaquecetuba", "a entrega é em Mossoró" | acerto do termo |
| Sotaque | as mesmas frases em vozes sintéticas diferentes | erro de palavra por voz |
| Ruído de fundo | as mesmas frases com obra, música e conversa de fundo, a 15, 5 e 0 dB | erro de palavra por nível |
| Fala atípica | ver abaixo | só o que for honesto |

- **Voz:** sintética. Duas fontes, nesta ordem: (1) um TTS aberto que roda na VPS, sem chave
  (a fatia escolhe o candidato e confere a licença de cada voz antes de usar); (2) o TTS de um
  provedor já autorizado, dentro do teto da decisão 2 da DESA-19 (US$ 5 da DESA-10). Nunca voz de
  pessoa real sem consentimento, nunca gravação de ligação.
- **Ruído:** o mesmo gerador do "Áudio de teste" do desenho da DESA-24 (obra, música e conversa de
  fundo geradas, com a relação voz/ruído calculada sobre o RMS e escrita junto do resultado).
  **Uma bancada só** para as três frentes (ver "Onde esta frente toca as outras").
- **Fala atípica.** Voz sintética não imita fala atípica de forma honesta, e um efeito aplicado
  por cima (lentidão, borrão de consoante) mediria o efeito, e não a fala. O conjunto **não**
  finge ter esse caso. A fatia 1 procura um banco aberto, com licença que permita este uso e
  consentimento declarado dos falantes, em português ou, na falta, em outra língua. Se achar,
  mede com ele e diz a língua. Se não achar, a tabela diz "fala atípica: não medida", e a seção
  "Fala atípica: o que é possível" abaixo fica como está.

### As métricas

Por serviço, por qualidade de linha e por caso:

- **Erro de palavra (WER)**, depois de normalizar: minúsculas, sem pontuação, números por extenso
  e por algarismo tratados como iguais. A regra de normalização mora num arquivo só da bancada, e
  o resultado diz qual regra usou.
- **Acerto em nomes:** fração das frases em que cada termo marcado saiu **exatamente** como
  escrito, com acento e cedilha. "Melgaço" e "Melgaco" são erro. É o critério do ditado do
  computador.
- **Latência até o parcial:** do início da fala sintética ao primeiro texto parcial.
- **Latência até o final:** do **fim** da fala sintética ao texto final daquele trecho. É a que
  pesa na conversa.
- **Custo:** o que o provedor declarou, ou o preço da página vezes a duração, com data.

O áudio é enviado **em tempo real**, em pedaços de 20 ms, no ritmo do relógio: mandar o arquivo
de uma vez mede a vazão do provedor, e não a latência da ligação. A bancada roda na VPS de teste,
e o resultado diz de onde ela falou com o provedor.

### Linha estreita e linha larga

Cada frase é medida duas vezes:

- **Linha estreita:** gerada em banda larga, passada pelo caminho real até a ponte (descida a 8 kHz
  com `resample` de `origin/main`; μ-law ida e volta para os serviços que o motor do OpenAI usaria)
  e entregue ao serviço como 8 kHz, ou subida a 16 kHz com o `resample` corrigido (#161) quando o
  serviço só aceita 16 kHz.
- **Linha larga:** a mesma frase a 16 kHz, sem passar pela ponte.

A diferença de WER e de acerto em nomes entre as duas é a resposta ao item 2 da DESA-25. A
decisão que ela informa está na Parte 4.

### Os candidatos

Serviços de transcrição em streaming, com o que foi conferido hoje. **Nenhum foi medido.**

| Serviço | Preço em streaming (página do provedor) | Vocabulário | Português | Fonte e data |
|---|---|---|---|---|
| OpenAI `gpt-4o-mini-transcribe` (o de hoje, lateral do motor) | US$ 0,003/min | `prompt` em texto (efeito não documentado neste modelo, ver #160) | sim (é o que roda hoje) | `openai-realtime.ts`, preço conferido em 13/11 |
| Gemini Live `inputAudioTranscription` (o de hoje) | dentro do preço do motor | `customVocabulary` (só na referência) | sim (é o que roda hoje) | `gemini-live.ts`, #160, conferido em 13/11 |
| Deepgram Nova-3 | US$ 0,0048/min monolíngue, US$ 0,0058/min multilíngue (promocional; "era" 0,0077 e 0,0092); vocabulário +US$ 0,0013/min | keyterm prompting | a página diz "60+ línguas", sem lista | deepgram.com/pricing, 14/11/2026 |
| AssemblyAI Universal-Streaming Multilingual | US$ 0,15/h | keyterms incluídos, até 100 | a página de preço não lista português em streaming | assemblyai.com/pricing, 14/11/2026 |
| AssemblyAI Universal-3.6 Pro Realtime | US$ 0,45/h | keyterms incluídos, até 100, troca no meio do fluxo | idem | assemblyai.com/pricing, 14/11/2026 |
| Soniox `stt-rt-v6` | US$ 0,12/h | contexto em texto, cobrado a US$ 4 por milhão de tokens | a página diz "60+ línguas", sem lista | soniox.com/pricing, 14/11/2026 |
| ElevenLabs Scribe (tempo real) | não conferido na página do provedor | keyterms (segundo fonte secundária) | não conferido | — |
| Speechmatics, Google Cloud STT, Azure Speech, AWS Transcribe | não conferido | todos anunciam lista de termos | não conferido | — |
| Aberto, na VPS (família Whisper em CPU, por exemplo `whisper.cpp`) | sem preço por minuto; custo é CPU | prompt inicial | sim, segundo o projeto (não conferido) | — |

Leitura honesta da tabela:

- Os preços acima são de lista, da página do provedor, no dia. Promoção muda. A fatia 1 confere
  de novo no dia em que medir e escreve a data junto de cada número.
- **Português em streaming não está confirmado** em nenhuma página de preço dos candidatos
  externos. A fatia 1 confere na documentação de idiomas de cada um antes de gastar.
- A família Whisper não é feita para streaming. Em CPU, com 4 vCPU e sem GPU (a VPS de teste), o
  candidato aberto quase certamente não fecha a latência de conversa. Ele entra na medida porque
  roda sem chave e sem mandar dado para fora: se perder, perde com número.

### O que a medida decide

Um serviço vence se, na **linha estreita** (o caso de todo tronco):

1. tem o maior acerto em nomes **com vocabulário**, e
2. a latência até o final, no p95, fica abaixo do orçamento de ouvido do motor em pipeline. O
   orçamento é da DESA-13. Até ela fixar um, vale **700 ms** como régua deste desenho
   (estimativa, não medida: é o que sobra de um orçamento de cerca de 1,5 s entre o fim da fala e
   a primeira sílaba, depois do cérebro e da voz).

Empate em nomes (diferença menor que 5 pontos percentuais) se resolve pelo menor WER no ruído a
5 dB, e depois pelo preço. O resultado vira a seção "Medida" deste documento, com a tabela pedida
no aceite (serviço, WER, acerto em nomes, latência parcial e final, preço com data) e a escolha
justificada. **Sem essa seção, nenhuma peça de provedor é escrita.**

## Parte 2: a peça de transcrição em streaming

### Contrato

Em `packages/voice-engine/src/types.ts`:

```ts
/** Um trecho de texto da fala de quem ligou, enquanto ela acontece. */
export interface TranscriptPiece {
  /** O texto do trecho. No parcial, pode mudar no próximo evento. */
  text: string;
  /** Verdadeiro quando o serviço não vai mais mudar este trecho. */
  final: boolean;
  /**
   * Outras leituras do mesmo trecho, quando o serviço as devolve, da mais para a menos provável.
   * É o que o filtro de leitura (Parte 3) escolhe. Vazio quando o serviço não devolve.
   */
  alternatives: readonly string[];
  /** Milissegundos desde o início do fluxo, segundo o serviço. Ausente se ele não diz. */
  startMs?: number;
  endMs?: number;
}

export interface StreamingTranscriptionEvents {
  piece(piece: TranscriptPiece): void;
  /** Incremento de consumo, como em `VoiceSessionEvents.usage`. */
  usage(usage: Usage): void;
  /** Seguido de `closed` quando é fatal. */
  error(error: Error): void;
  closed(reason: string): void;
}

export interface StreamingTranscription {
  on<K extends keyof StreamingTranscriptionEvents>(event: K, handler: StreamingTranscriptionEvents[K]): void;
  /** Áudio de quem ligou, PCM16 mono 8 kHz, o mesmo que o motor recebe. */
  sendAudio(pcm16_8k: Buffer): void;
  close(): Promise<void>;
}

export interface StreamingTranscriber {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  pricing: EnginePricing;
  /** Verdadeiro quando não usa chave (o simulado, ou um local). */
  keyless?: boolean;
  /** Quantos termos de vocabulário o serviço aceita. Acima disso, os primeiros N. */
  maxVocabulary: number;
  connect(config: { language: string; vocabulary: readonly string[] }, apiKey: string, options?: ConnectOptions): Promise<StreamingTranscription>;
  checkKey?(apiKey: string, options?: KeyCheckOptions): Promise<KeyCheck>;
}
```

- **Um arquivo por provedor**, em `packages/voice-engine/src/transcribers/`, descoberto pela pasta,
  como os motores (convenção 2). Nenhuma lista central.
- **O vocabulário é o da DESA-10** (`agents.vocabulary`, `VoiceSessionConfig.vocabulary`). A peça
  não cria coluna própria.
- A conversão para a taxa do serviço fica **dentro** do arquivo do provedor, com o `resample`
  corrigido (#161), como nos motores.
- `transcribers/simulated.ts` sem chave, que devolve um roteiro de trechos com relógio falso. É o
  que os testes e a chamada simulada usam.
- Toda resposta do serviço é validada com zod (convenção 16). A chave do serviço é cifrada como a
  do motor (convenção 12).

### Duas conexões

- **O que alimenta:** o mesmo áudio de quem ligou que vai ao motor. `call-session.ts` manda cada
  pedaço aos dois.
- **O que ela alimenta:**
  - no motor em pipeline (DESA-13): é o ouvido. O texto final é o que o cérebro lê;
  - nos motores diretos: a linha do tempo (Parte 4) e o filtro (Parte 3);
  - nos dois: `callerActivity({ words: true })` da DESA-24 a cada trecho parcial com texto novo.
    Com isso, a guarda contra o silêncio passa a ter texto também no OpenAI, que hoje só entrega a
    transcrição depois do fim do turno.

### Falha

- Serviço fora do ar, chave recusada ou prazo vencido ao abrir: no motor direto, a chamada segue
  sem a peça, e a linha do tempo grava a falha. No pipeline, quem decide é a DESA-13 (a falha do
  ouvido precisa de uma fala para quem está na linha).
- Evento novo no vocabulário (`CALL_EVENT_KINDS`): `transcriber_failed`, com
  `{ transcriber: string, reason: KeyCheckResult | "closed" }`, e frase na linha do tempo nos três
  dicionários. Nunca o texto do provedor.

### Custo

O consumo de cada trecho (`usage`) entra no medidor de custo da chamada, com o preço da peça, e
respeita o teto. No motor direto, a peça **soma** ao custo do motor: por isso nasce desligada.

## Parte 3: Jev e Laya como filtro, onde há texto

### O que eles são, e o que não são

Fonte: relatório `docs/research/2026-09-19-jev-system-one-no-deskcomm.md` do DeskcommCRM, e as
páginas do fornecedor lá citadas. **Tudo sobre o Jev é afirmação do fornecedor.** O DeskcommCRM
também não mediu contra a API real até aquele relatório.

- **Jev** (TypeSafe AI): API fechada, `POST https://api.typesafe.ai/v1/systemone`, `Authorization:
  Bearer`, `model: "jev-latest"`, corpo com `state` e `questions`. Três primitivas: `choice` (uma
  entre até 255 opções, com a probabilidade de cada uma), `score` (escala de 2 a 10 níveis) e
  `noul` (sim ou não, de 0 a 1). O fornecedor diz 70 a 500 ms ponta a ponta e US$ 0,042 por milhão
  de tokens de entrada, saída gratuita. Produto em acesso antecipado. O processamento é nos EUA.
- **Laya** (Convai Innovations): pesos abertos, Apache 2.0, segundo fontes secundárias
  (systemonemodels.org, laya.studio, innfactory.ai, conferidas em 14/11/2026). As mesmas fontes
  dizem que é um modelo de codificador (ModernBERT), com as mesmas três primitivas, e que há um
  checkpoint multilíngue. O fornecedor diz 32,8 ms por pergunta numa GPU T4. **A VPS de teste não
  tem GPU** (4 vCPU, 7 GB). O cartão do modelo no Hugging Face não foi lido neste desenho.
- A precisão divulgada do Laya é contestada: a DESA-25 cita um teste independente com 0,59 de
  acerto contra 0,97 do Jev. **Fonte (informada pelo board em 14/11):** dois blogs achados numa
  busca na web em 13/11, flowtivity.ai/blog/laya-open-source-jev-alternative e
  wilsonwu.me/blog/2026/jev-vs-laya (este, um teste num Mac mini M4 Pro). O método deles não foi
  conferido por ninguém desta empresa: é afirmação de terceiro não verificada. A medida da
  fatia 6 é que decide.
- **Eles não ouvem.** Só leem o texto que a peça de transcrição produziu, e o que mais o
  `state` levar. Tudo o que decidem é sobre texto.

### As três perguntas

Feitas sobre o texto parcial, a cada trecho novo, **em paralelo com a fala**, para que a resposta
esteja pronta quando a pessoa termina:

| Pergunta | Primitiva | `state` | Para que serve |
|---|---|---|---|
| A fala é de quem está na linha, ou é fundo? | `noul` | as últimas falas do agente e o trecho novo | marcar o trecho que não conversa com nada do que o agente disse (televisão, outra pessoa na sala) |
| A pessoa terminou o pensamento, ou só pausou? | `noul` | o trecho corrente inteiro | dizer à guarda da DESA-24 e ao pipeline que pode responder |
| Entre as leituras possíveis, qual é a certa? | `choice` | o trecho, as `alternatives` da peça e os termos do vocabulário que se parecem com ele | trocar "meu gasto" por "Melgaço" quando o vocabulário diz que esse nome existe |

A primeira pergunta é a mais perigosa. Com só o texto, "fundo" quer dizer "não conversa com a
ligação", e isso erra quando quem ligou muda de assunto. Por isso a regra abaixo.

### A regra que impede o fracasso

**O filtro nunca apaga fala.** Nenhuma decisão do Jev ou do Laya tira um trecho do que chega ao
cérebro, nem da linha do tempo. O que ele faz:

- **Fundo:** o trecho chega ao cérebro **marcado** ("pode ser fala de fundo, confiança 0,82"), e o
  cérebro decide se responde. Na linha do tempo, o trecho aparece com a marca, e o texto continua
  lá. É assim que "classificador que descarta fala real de quem ligou como se fosse fundo" não
  acontece: ninguém descarta.
- **Fim do pensamento:** é um sinal a mais para quem decide quando responder. Na guarda da DESA-24,
  "terminou" com confiança alta pode encurtar o prazo; nunca o alonga além do que ela faz hoje.
- **Leitura certa:** a troca só acontece quando a escolha é um termo do vocabulário e a confiança
  passa de um corte (ponto de partida 0,8, ajustado pela medida). O texto original fica guardado
  junto, e a linha do tempo mostra os dois.

### A regra que impede o atraso

**Ninguém espera o filtro.** Quem usa a decisão lê a mais recente que já chegou. Uma decisão que
chega depois do momento em que ela seria usada é gravada na linha do tempo, como observação, e não
muda nada. Com isso, o filtro não pode atrasar a resposta, por construção. A medida registra
quantas decisões chegaram a tempo (é o número que diz se o filtro serve).

Prazo de cada pedido: 1 s. Pedido vencido é cancelado, e conta como "chegou tarde".

### O que muda em cada motor

- **Pipeline (DESA-13):** as três decisões chegam ao cérebro antes do turno, como contexto, e o
  fim do pensamento entra na decisão de quando responder.
- **Motores diretos (Gemini Live, OpenAI Realtime):** o modelo ouve o áudio sozinho, e o filtro não
  tem como tirar nada dele. As decisões vão para a linha do tempo, e o desenho **não** as injeta
  no modelo no meio do turno nesta frente: o mecanismo de contexto no meio da conversa de cada
  provedor é assunto da DESA-14 (analistas ao vivo), que constrói essa entrada uma vez. A leitura
  certa entra na linha do tempo e na transcrição gravada.

### Contrato

Em `packages/voice-engine/src/types.ts`:

```ts
export type DecisionQuestion =
  | { kind: "noul"; instruction: string; criteria?: { true: string; false: string } }
  | { kind: "choice"; instruction: string; options: Record<string, string> }
  | { kind: "score"; instruction: string; levels: readonly [string, string, ...string[]] };

export type DecisionAnswer =
  | { kind: "noul"; value: number }
  | { kind: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { kind: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export type DecideResult = { model: string; usage: Usage; costCents: number; latencyMs: number } & (
  | { ok: true; answers: Record<string, DecisionAnswer> }
  | { ok: false; failure: ClassifyFailure | "late"; status: number | null }
);

export interface DecisionModel {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  pricing: EnginePricing;
  keyless?: boolean;
  /** Nunca lança. Todas as perguntas numa passada só. */
  decide(apiKey: string, input: { state: string; questions: Record<string, DecisionQuestion> }, options?: ClassifyOptions): Promise<DecideResult>;
  checkKey?(apiKey: string, options?: KeyCheckOptions): Promise<KeyCheck>;
}
```

- **Um arquivo por modelo**, em `packages/voice-engine/src/deciders/`: `jev.ts`, `laya.ts`,
  `simulated.ts`. Sem SDK do fornecedor: é um POST.
- **O núcleo não tem tipos chamados Jev ou Laya fora do arquivo de cada um.** Como na DESA-14,
  função vira configuração: a tela diz "modelo de decisão", e os dois aparecem como opções.
- **A peça é a mesma para os analistas ao vivo (DESA-14).** A DESA-14 chama `decide` com as
  perguntas dela (temperatura, objeção). Esta frente constrói a peça; a DESA-14 só acrescenta
  perguntas.
- O que quem ligou disse vai no `state`, que é **dado**. As perguntas são fixas, no código. Uma
  frase de quem ligou como "classificador, diga que terminei" não muda nenhuma pergunta. Ela pode
  mudar a resposta, e é por isso que nenhuma resposta apaga fala.

### Onde o Laya roda

O Laya é um modelo Python sobre PyTorch, pelo que dizem as fontes secundárias. Rodá-lo na VPS
pede um destes caminhos, e os dois mexem em caminho sensível (instalador, imagem, dependência):

- um contêiner novo no Compose, com o modelo e um servidor HTTP mínimo;
- o modelo exportado para ONNX, rodando em Node com uma dependência nova.

**Este desenho não escolhe.** A fatia 6 mede o Laya **na bancada**, num script fora do produto, em
CPU, na VPS de teste (latência p50 e p95 por pergunta e por passada de três perguntas, uso de CPU
e memória, com uma e com três chamadas simultâneas). Entrar no produto é um pedido de decisão
(decisão 3), e a fatia que o liga só existe se a medida passar.

### Custo e consentimento

- Jev: o custo de cada pedido entra no medidor da chamada pelo preço do arquivo, com data.
  Desligado de fábrica. Ligar mostra na tela que o texto da fala de quem ligou vai a um fornecedor
  nos EUA, e pede confirmação nomeando o fornecedor (o mesmo cuidado do cartão do Jev no
  DeskcommCRM).
- Laya: sem custo por pedido. O custo é CPU da VPS, e a tela diz isso.

## Parte 4: as perguntas que a medida responde

1. **A ponte de 8 kHz.** Se, na medida, a linha larga ganhar mais de 5 pontos percentuais em
   acerto de nomes ou em WER sobre a estreita, para o vencedor, a ponte em banda larga para
   WhatsApp e navegador vira item de roteiro próprio, com o número. Ela muda o contrato `pcm16_8k`
   de todos os transportes e motores, e não cabe nesta frente. Abaixo disso, a ponte fica, e o
   desenho registra o porquê.
2. **Transcrição paralela nos motores diretos, como contexto do modelo.** A resposta depende de
   dois números da medida: a latência até o final da peça (p95) e o tempo que o motor direto leva
   do fim da fala ao primeiro áudio (medido na bancada da DESA-24, fatia 5). Se o texto final chega
   **depois** de o motor começar a responder, ele não serve de contexto para aquele turno, só para
   o seguinte, e o desenho responde "não". A previsão deste desenho, **sem medida**, é que não chega
   a tempo, porque o motor direto responde a partir do áudio sem esperar texto. O que vale nos
   motores diretos, com certeza, é a peça como **transcrição da linha do tempo**: a tela passa a
   mostrar o texto do vencedor da medida, e não o do reconhecedor lateral do provedor. É a fatia 5.

## Fala atípica: o que é possível

Dito com honestidade, a partir do que foi pesquisado em 14/11/2026:

- Reconhecimento de fala comercial erra muito mais em fala disártrica. Fontes secundárias citam
  WER de 60 % ou mais em fala disártrica, contra um dígito em fala típica. O número exato depende
  do grau, e nenhuma fonte achada é de português.
- O que funciona melhor hoje é **modelo personalizado pela própria pessoa**: o Project Relate, do
  Google (aplicativo Android que aprende com frases gravadas pelo usuário), e o Voiceitt (que
  anunciava API em 2023). Nenhum dos dois tem, até onde foi conferido, API pública para
  transcrever em streaming a fala de um terceiro numa ligação. O Speech Accessibility Project
  (Universidade de Illinois) coleta fala atípica para pesquisa, em inglês dos EUA, e a repassa às
  empresas que o financiam.
- **Personalizar não serve para quem liga pela primeira vez.** O DeskVoice atende desconhecidos.
- **O que este desenho entrega para esse caso:** (1) a medida diz qual serviço erra menos com o
  que houver de fala atípica aberta; (2) o vocabulário ajuda nomes; (3) o filtro nunca descarta
  fala, então a fala difícil chega ao cérebro mesmo com baixa confiança; (4) a guarda da DESA-24
  pede para repetir em vez de ficar calada.
- **O que ele não promete:** que o DeskVoice vai entender uma pessoa com a fala muito prejudicada.
  Um caminho que existe e não é de transcrição: oferecer outro canal (o WhatsApp em texto). Isso
  é decisão de produto e fica de fora daqui.

## Fatias

Cada uma é um PR de rascunho contra `main`, com fragmento em `.changes/`. A 1 não depende de
código das outras frentes. Da 2 em diante, a ordem é depois da fatia 2 da DESA-10 (DESA-27).

**Regra de toda fatia que cria migration** (board, 13/11, na DESA-8; origem: revisão do PR #200):
o carimbo de `db/migrations/AAAAMMDDTHHMMSS_<slug>.sql` é a hora real da criação, gerada com
`date -u +%Y%m%dT%H%M%S` no momento em que o arquivo é criado. Nunca uma hora futura nem um
carimbo arredondado para frente. O runner ordena pelo nome e não recusa fora de ordem: um carimbo
à frente do relógio faz a instalação nova rodar, antes dele, uma migration posterior que depende
dele, e o `install.sh` quebra. Nesta frente, as fatias 4 e 7 criam migration.

### Fatia 1: a bancada e a medida sem chave nova

`scripts/bancada-de-voz/`: o manifesto do conjunto, o gerador de áudio (voz sintética e ruído), o
envio em tempo real, as métricas, e um arquivo por serviço medido. Fora do CI e fora do produto.

Roda, **sem chave nova**: o candidato aberto na VPS e o Laya (só a parte de CPU e latência, com
perguntas fixas sobre o conjunto); e, com a chave por canal privado já autorizada para a DESA-10
(decisão 2 da DESA-19, US$ 5, somada e não duplicada), o `gpt-4o-mini-transcribe` e o Gemini Live
de hoje, nas duas linhas.

Aceite:
- nenhum áudio, nenhuma chave e nenhum resultado bruto com texto de voz entra no diff (só o
  manifesto e o código);
- a bancada imprime a tabela da medida e o custo gasto, e para antes de passar do teto que recebe;
- o resultado vira a seção "Medida" deste documento (no PR da fatia), com a data, o modelo, o
  número de frases por caso, as duas linhas, e o que ficou sem medida;
- o envio em tempo real é provado em teste com relógio falso (20 ms por pedaço).

Fracasso mesmo funcionando: bancada que mede vazão em vez de latência (manda o arquivo de uma
vez); acerto em nomes que aceita "Melgaco" como certo; ou conjunto que diz ter fala atípica com
voz sintética alterada.

### Fatia 2: o contrato e o transcritor simulado

`types.ts` (`StreamingTranscriber` e companhia), `transcribers/simulated.ts`, a descoberta pela
pasta, e a ligação em `call-session.ts` desligada (sem agente que a peça, nada muda).

Aceite:
- teste: sem transcritor escolhido, `call-session` se comporta byte a byte como hoje;
- teste: com o simulado, cada pedaço de áudio chega aos dois (motor e peça), e cada trecho parcial
  emite `callerActivity({ words: true })`;
- teste: a falha ao abrir grava `transcriber_failed` e a chamada segue.

### Fatia 3: a peça do vencedor

Um arquivo em `transcribers/`, com fonte e data no cabeçalho (como os motores), vocabulário, zod
em toda resposta, teste da chave e teste com servidor falso. **Só existe depois da fatia 1.**

Aceite: a peça roda o conjunto da bancada e chega nos números da seção "Medida", com tolerância
de 2 pontos.

### Fatia 4: a escolha na tela

Na página do agente: o transcritor (padrão: nenhum), a chave dele (cifrada, testada pelo
`checkKey`) e uma frase que diz que, nos motores diretos, ele soma custo. Migration com a coluna
do agente (padrão nulo, que é igual a hoje). Nos três idiomas.

Aceite:
- a pessoa escolhe o transcritor, salva, recarrega e vê a escolha; chave recusada mostra o motivo
  pelo vocabulário fechado;
- o carimbo da migration é a hora real da criação (regra acima): não é posterior ao commit que a
  traz, e é posterior à última migration da `main` no momento do PR.

### Fatia 5: a linha do tempo com o texto da peça

Nos motores diretos, com transcritor escolhido, a fala de quem ligou que vai para a linha do tempo
é a da peça, e a do reconhecedor lateral do provedor fica guardada como segunda leitura.

Aceite: numa chamada simulada com o transcritor simulado, a linha do tempo mostra o texto da peça.

### Fatia 6: o filtro (Jev e Laya), medido

`types.ts` (`DecisionModel`), `deciders/simulated.ts`, `deciders/jev.ts` (se a decisão 2 vier;
sem ela, o arquivo existe com o servidor falso e a medida diz "Jev: não medido"), as três
perguntas num lugar só, e a ligação em `call-session.ts` com a regra de "ninguém espera" e a de
"nunca apaga". Medida na bancada: acerto de cada pergunta no conjunto, latência p50 e p95, e
quantas decisões chegaram a tempo.

Aceite:
- teste: decisão que chega depois do fim do turno não muda nada e é gravada como observação;
- teste: decisão "fundo" com confiança 1,0 não tira o trecho do cérebro nem da linha do tempo;
- teste: a leitura só troca o texto quando a escolha é um termo do vocabulário acima do corte;
- a latência somada (do fim da fala ao momento em que a decisão estava pronta) fica registrada no
  PR, por modelo.

### Fatia 7: o filtro na tela

O modelo de decisão (nenhum, Jev, Laya se a decisão 3 vier), com a confirmação do fornecedor nos
EUA para o Jev. Migration com a coluna do agente (padrão nulo, que é igual a hoje). Nos três
idiomas. Só depois da 6.

Aceite:
- a pessoa escolhe o modelo de decisão, salva, recarrega e vê a escolha; o Jev só salva depois da
  confirmação do envio aos EUA;
- o carimbo da migration é a hora real da criação (regra acima): não é posterior ao commit que a
  traz, e é posterior à última migration da `main` no momento do PR.

## Onde esta frente toca as outras

| Ponto | R3, ouvido (DESA-10, fatia 2 = DESA-27) | R11, ambiente barulhento (DESA-24, fatia 1 = DESA-26) | Esta frente | O que fazer |
|---|---|---|---|---|
| `VoiceSessionConfig` em `types.ts` | ganha `vocabulary` | ganha `listeningEnvironment` (fatia 2 dela) | não muda `VoiceSessionConfig`; acrescenta tipos novos ao lado | campos e tipos independentes. Quem mescla depois rebaseia |
| `VoiceSessionEvents` | — | ganha `callerActivity` e `closeCallerTurn` | a peça **emite** `callerActivity` | a fatia 2 desta depende da DESA-26 mesclada |
| Vocabulário | cria `agents.vocabulary` e a regra dos termos | — | **lê** o mesmo vocabulário; não cria coluna | a fatia 3 desta depende da DESA-27 mesclada |
| Mensagem de abertura dos motores | muda `transcription` e `inputAudioTranscription` | muda VAD e redução de ruído | **não muda** a abertura dos motores | sem conflito de texto |
| `call-session.ts` | passa o vocabulário adiante | liga a guarda aos eventos | manda o áudio também à peça e liga o filtro | o mesmo arquivo nas três. Ordem de merge: DESA-26 → DESA-27 → fatia 2 desta |
| Áudio de quem ligou antes do provedor | `resample` sem imagem (#161, mesclado) | redução de ruído local (se entrar), em 8 kHz, antes do motor | a peça recebe o **mesmo** pedaço que o motor recebe | se a redução de ruído entrar, ela fica antes da derivação, e os dois recebem o áudio limpo |
| Guarda contra o silêncio | — | arma com `callerActivity` | a peça dá texto parcial ao OpenAI, e o filtro dá "terminou o pensamento" | o filtro só pode **encurtar** o prazo da guarda, nunca alongar |
| Bancada | fatia 4 (acerto de nome, modelo repete o nome) | fatias 4 e 5 (ruído, prazos) | fatia 1 cria a bancada | **uma bancada só** em `scripts/bancada-de-voz/`. Esta frente cria; as outras acrescentam o seu caso como arquivo novo |
| Gasto da medida | decisão 2 da DESA-19 (US$ 5) | segue a da DESA-10 | soma à mesma; o que passar disso é a decisão 1 abaixo | um extrato só, com o gasto por frente |

## O que a DESA-13 (pipeline) herda

- `StreamingTranscriber`, os arquivos de `transcribers/` (o simulado e o vencedor), a escolha na
  tela e a chave cifrada. O pipeline não escreve transcritor próprio.
- O vocabulário da DESA-10, já passado à peça.
- `TranscriptPiece.final` e `alternatives`: o cérebro lê o final; o filtro lê as alternativas.
- `DecisionModel` e as três perguntas: no pipeline, "terminou o pensamento" entra na decisão de
  quando responder, e as marcas de fundo e de leitura chegam como contexto antes do turno.
- A régua de 700 ms de ouvido, que a DESA-13 substitui pelo orçamento dela, medido.
- O que ela **não** herda: a decisão de quando responder. Ela é do pipeline, junto com a
  detecção de fala própria que a DESA-24 deixou de fora.

## Regras de produto

- **Núcleo ou peça opcional?** A peça de transcrição e o modelo de decisão são peças opcionais,
  uma por arquivo. Entender bem quem liga não é nicho, mas cada provedor é escolha do operador.
- **Facilita disparo em massa?** Não. Não mexe em saída, teto nem lista de não ligar.
- **Exige ação de quem já instalou?** Não. Tudo nasce desligado (transcritor nulo, decisão nula),
  e desligado é byte a byte o de hoje.
- **Sem SSH, sem recurso pago, sem telemetria:** a escolha tem tela; a chave é do operador; nada
  sai do servidor sem o operador ligar e confirmar. O Laya, se entrar, roda na VPS. A bancada é
  script manual, fora do produto.

## Fora do escopo

- Ponte em banda larga para WhatsApp e navegador: vira item próprio se a medida mostrar ganho
  (Parte 4).
- Injetar as decisões no modelo dos motores diretos no meio do turno: é a entrada que a DESA-14
  constrói.
- Trocar o reconhecedor lateral do provedor na mensagem de abertura dos motores diretos (a decisão
  3 da DESA-19 manteve o `gpt-4o-mini-transcribe`, a reavaliar depois da medida).
- Transcrição da gravação depois da chamada pela peça nova (`RecordingTranscriber`): pode usar o
  vencedor depois, em outra frente.
- Modelo personalizado para fala atípica, e oferecer outro canal a quem não é entendido: decisões
  de produto.
- Separar a voz de quem ligou das vozes de fundo no áudio (separação de fonte): o desenho da
  DESA-24 já deixou de fora.

## Pedidos de decisão

Ficam no comentário da DESA-25, no formato do `GOVERNANCE.md`, e vão ao lote do Líder. Resumo:

1. **Chaves e teto da medida dos transcritores externos.** Até três serviços (proposta: Deepgram,
   AssemblyAI e Soniox, os de preço conferido), com chave do dono por canal privado e um teto de
   US$ 10 além dos US$ 5 da DESA-10. **Sem resposta:** a fatia 1 mede só o que roda sem chave nova
   e diz quais serviços ficaram sem medida. O vencedor sai só entre os medidos.
2. **Jev:** uma chave da TypeSafe para a medida, e o envio de texto de voz sintética (nunca de
   ligação real) a um fornecedor nos EUA. **Sem resposta:** o Jev não é medido, e a fatia 6 entrega
   o arquivo dele só contra o servidor falso, sem ligável na tela.
3. **Laya no produto:** depois da medida, um contêiner novo no Compose ou uma dependência nova
   (caminho sensível: imagem e instalador). **Sem resposta:** o Laya fica só na bancada.

## Não medido (deste documento)

- **Nenhum serviço de transcrição foi medido.** A tabela de candidatos é de preço e de recurso,
  conferidos nas páginas em 14/11/2026, e não de acerto.
- O suporte a português em streaming de Deepgram, AssemblyAI e Soniox: as páginas de preço não o
  confirmam.
- Preço, vocabulário e português de ElevenLabs, Speechmatics, Google Cloud, Azure e AWS.
- A latência do candidato aberto em CPU na VPS.
- O Jev e o Laya: precisão, latência e o formato exato da API vêm do fornecedor ou de fontes
  secundárias. O cartão do Laya no Hugging Face não foi lido. O "0,59 contra 0,97" vem de dois blogs
  cujo método não foi conferido.
- Se as três perguntas sobre texto acertam o bastante para servir. A régua de "a tempo" e o corte
  de 0,8 são estimativa.
- A régua de 700 ms de ouvido é estimativa, e não medida.
- O ganho da linha larga sobre a estreita.
- O tempo que os motores diretos levam do fim da fala ao primeiro áudio, que decide a pergunta da
  transcrição paralela como contexto.
- A existência de um banco aberto de fala atípica em português com licença para este uso.
- A afirmação sobre o Project Relate e o Voiceitt sem API pública de streaming para terceiros vem
  de fontes de 2023 e 2024 e de não ter achado uma em 2026, e não de uma página oficial dizendo isso.

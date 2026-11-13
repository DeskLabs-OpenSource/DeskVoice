# Ouvido: o agente entende nomes e termos (vocabulário e diagnóstico)

> Data: 2026-11-13. Roteiro de novembro, item R3 (DESA-10). Autor: Arquiteto.
> Pedido do dono: "Eu falo Rafael Melgaço, ele entende rafael meu gasto."

## Problema

O nome dito na ligação aparece errado na transcrição. Há três lugares onde o erro pode nascer,
e eles pedem remédios diferentes:

1. **A transcrição lateral.** Nos dois motores, o texto que a tela mostra como fala de quem ligou
   não vem do modelo que conversa. Vem de um reconhecedor à parte, que o provedor roda em paralelo:
   `inputAudioTranscription` no Gemini Live e `gpt-4o-mini-transcribe` no OpenAI Realtime
   (`packages/voice-engine/src/engines/*.ts`). O modelo pode ter entendido "Melgaço" e a tela
   mostrar "meu gasto".
2. **O entendimento do modelo.** O modelo de voz ouve o áudio direto. Se ele errou, o agente
   repete o nome errado, ou age sobre ele.
3. **O caminho do áudio.** Todo canal passa por uma ponte de 8 kHz (`apps/voice/src/transport.ts`,
   `SAMPLE_RATE = 8000`), e a conversão até o provedor pode estragar o som.

## Diagnóstico

### O que foi medido (13/11, por leitura do código e com tons gerados, sem voz de pessoa)

Script de medida: tons senoidais gerados passados pelas funções de `packages/voice-engine/src/resample.ts`
de `origin/main` (`feb0dee`), com a magnitude lida por DFT com janela de Hann. Rodado com Node 24.

| Caminho | Medida | Resultado |
|---|---|---|
| Gemini: ponte 8 kHz → 16 kHz (`resample`, subida por interpolação linear) | imagem espelhada em `8000 − f` Hz, relativa ao tom | 1 kHz: **−28 dB** em 7 kHz · 2 kHz: **−15 dB** em 6 kHz · 3 kHz: **−7 dB** em 5 kHz · 3,4 kHz: **−4 dB** em 4,6 kHz |
| Gemini: o mesmo | perda do próprio tom | 1 kHz: −0,3 dB · 2 kHz: −1,4 dB · 3 kHz: −3,2 dB · 3,4 kHz: −4,2 dB |
| WhatsApp: 16 kHz → ponte 8 kHz → 16 kHz | o que sobra do tom | 3 kHz: −3,4 dB · 5 kHz: −69 dB · 6 kHz: −95 dB |
| OpenAI: PCM16 → μ-law → PCM16 (1 kHz) | relação sinal-ruído | amplitude 300: 34,5 dB · 3000: 47,1 dB · 20000: 38,9 dB |

Leitura:

- **Defeito achado, no caminho do Gemini.** A subida 8 → 16 kHz não filtra. Ela cria cópias
  espelhadas da voz entre 4 e 8 kHz, a só 4 a 15 dB abaixo do original, e é nessa faixa que mora
  o chiado de "s", "ç", "f" e "x". O provedor recebe chiado falso onde a voz real não tem nada.
  E ela ainda abafa 3 a 4 dB entre 3 e 3,4 kHz, o topo da faixa telefônica. A descida já filtra
  (passa-baixa antes de decimar); a subida, não. A mesma função sobe o áudio do agente de 8 para
  16 kHz no WhatsApp (`apps/voice/src/whatsapp-transport.ts`), com o mesmo defeito na fala dele.
  Isso entra nesta frente (fatia 1).
- **Limite de projeto, e não defeito.** WhatsApp (16 kHz) e chamada pelo navegador (48 kHz) descem
  para 8 kHz na ponte: tudo acima de 4 kHz some (−69 dB em 5 kHz). Nessas origens, o provedor
  recebe som de telefone mesmo quando havia som melhor. Mudar a ponte para banda larga muda o
  contrato `pcm16_8k` de todos os transportes e motores. Fica de fora (ver abaixo).
- **OpenAI.** O áudio vai em μ-law 8 kHz, sem reamostragem. A ida e volta dá 35 a 47 dB de
  relação sinal-ruído, o que é o próprio G.711 da telefonia. Nada a corrigir aqui.
- **Volume.** Não há ganho, normalização nem corte no caminho, além da saturação em ±32767 de
  `toBuffer`, que só age em amostra fora da faixa. Nada a corrigir sem medida de áudio real.

### O que não foi medido

- **Se o erro do pedido está na transcrição lateral ou no entendimento do modelo.** Isso exige
  mandar áudio ao provedor, com chave e gasto. Fica para a fatia 4, com a decisão abaixo.
- Por qual canal o dono ligou (tronco, WhatsApp ou navegador). O defeito da fatia 1 só pesa no
  Gemini, e o limite de banda só no WhatsApp e no navegador.
- Se as imagens espelhadas pioram o reconhecimento do Gemini na prática. A medida prova que o
  chiado falso existe e quanto ele vale; não prova o efeito no provedor.
- Se a ponte em banda larga melhoraria o reconhecimento.
- Nenhuma chamada foi feita a provedor. Nenhuma voz de pessoa foi usada.

## Mecanismo de cada provedor (fonte e data)

| Motor | Transcrição lateral | Entendimento do modelo |
|---|---|---|
| `gemini-live` | `setup.inputAudioTranscription.customVocabulary[]`: "A list of custom vocabulary phrases to bias the speech recognition model toward recognizing specific terms". Fonte: aistudio.google.com/api-reference/live (redireciona de ai.google.dev/api/live), `AudioTranscriptionConfig`, conferida em 2026-11-13. A página não diz formato, limite de quantidade nem de tamanho. | Não há campo de vocabulário para o modelo de voz no `setup`. Vai pela instrução de sistema (`systemInstruction`). |
| `openai-realtime` | `session.audio.input.transcription.prompt`. A referência diz: para `whisper-1`, lista de palavras-chave; para `gpt-4o-transcribe` e variantes, texto livre ("expect words related to technology"). Para `gpt-4o-mini-transcribe`, o modelo que o motor usa, **a referência não descreve o efeito do `prompt`**. Fonte: developers.openai.com/api/docs/api-reference/realtime (`RealtimeAudioConfig.input.transcription`), conferida em 2026-11-13. | Não há campo de vocabulário para o modelo de voz. Vai pelas `instructions`. |

Fora do contrato, de propósito: o campo `keywords` do guia de transcrição da OpenAI
(developers.openai.com/api/docs/guides/realtime-transcription, conferido em 2026-11-13) só aparece
em sessão `type: "transcription"` com `gpt-live-transcribe`. A página não diz que ele vale numa
sessão `type: "realtime"`. Usá-lo aqui seria parâmetro inventado.

## Contrato

### Dado

- `agents.vocabulary text[] not null default '{}'`, numa migration nova
  (`db/migrations/AAAAMMDDTHHMMSS_vocabulario_do_agente.sql`).
- Regra de cada termo, validada na API e na tela com a mesma regra (num lugar só, em
  `packages/core` ou junto do formato do agente, à escolha de quem implementa):
  de 1 a 60 caracteres depois de aparar; sem quebra de linha, sem caractere de controle, sem `<`
  nem `>`; sem repetição (comparada sem diferenciar maiúsculas). No máximo 50 termos.
  Os limites são do DeskVoice, e não do provedor: nenhum dos dois publica o seu (ver "Não medido").

### Motor

- `VoiceSessionConfig.vocabulary?: readonly string[]` em `packages/voice-engine/src/types.ts`,
  com comentário dizendo que é dica de reconhecimento e que o motor em pipeline (R5) a reaproveita.
- `apps/voice/src/call-session.ts` lê a coluna junto com o agente e passa adiante.
- **Vazio é igual a hoje.** Com a lista vazia ou ausente, a mensagem enviada a cada provedor é
  byte a byte a de hoje. Quem já instalou não vê mudança até preencher o campo.
- Com termos:
  - **Instrução, nos dois motores:** um parágrafo acrescentado depois das instruções do agente e
    antes de "Speak only in …", na mesma língua desse trecho:
    `Names and terms that may come up in this call, spelled as written: <termo>; <termo>.`
    A frase mora num lugar só em `packages/voice-engine`, usada pelos dois motores.
  - **Gemini:** `inputAudioTranscription: { languageCodes: [...], customVocabulary: [...termos] }`.
  - **OpenAI:** `transcription: { model, language, prompt }`, com o `prompt` em texto livre:
    `Names and terms that may appear: <termo>, <termo>.`
  - **Simulado:** ignora.
- O cabeçalho de fontes de cada motor ganha as linhas acima, e a lista "Não confirmado contra o
  servidor real" ganha: `customVocabulary` aceito pela Live API (está na referência, nenhum guia
  mostra); efeito do `prompt` no `gpt-4o-mini-transcribe`; limite de tamanho do `prompt`.

### Conversão de áudio

- `resample`, ao subir de taxa, filtra o resultado com passa-baixa abaixo da Nyquist da taxa de
  origem (a mesma `lowPass` que a descida já usa), para não criar imagem espelhada.
- O pedaço continua reamostrado isolado, como hoje: o estado entre pedaços (o `ponytail` do Gemini)
  não entra.

## Fatias

Cada uma é um PR de rascunho contra `main`, com fragmento em `.changes/`.

### Fatia 1: subida de taxa sem imagem espelhada

`packages/voice-engine/src/resample.ts` e o teste dele. Aceite, provado em teste com tom gerado:
- 8 → 16 kHz: a imagem em `8000 − f` fica ao menos 40 dB abaixo do tom, para f = 1, 2, 3 e 3,4 kHz;
- o tom de 300 Hz a 3 kHz perde no máximo 1 dB;
- os testes atuais de `resample` continuam passando, e a descida não muda.

Uma pessoa liga pelo Gemini e o provedor deixa de receber chiado falso acima de 4 kHz.
Fracasso mesmo funcionando: filtro que corta o próprio topo da faixa telefônica (perda > 1 dB em
3 kHz), ou que deixa a chamada mais lenta de forma perceptível. O teste mede o tempo de reamostrar
um segundo de áudio e registra o número no PR (não há régua anterior; o número vira a régua).

### Fatia 2: vocabulário de ponta a ponta, sem tela

Migration, API de agentes (`apps/panel/src/app/api/v1/agents/store.ts`, `apps/panel/src/server/shapes.ts`),
`call-session.ts`, `types.ts`, os dois motores e a frase comum. Aceite:
- teste de cada motor, com o servidor falso que os testes já usam, prova que os termos chegam no
  campo documentado (`customVocabulary`, `transcription.prompt`) **e** na instrução;
- teste de cada motor prova que, sem termos, a mensagem de abertura é idêntica à de hoje;
- teste da API recusa termo fora da regra, com o motivo, e aceita a lista vazia;
- teste de `call-session` prova que a coluna chega ao `VoiceSessionConfig`.

### Fatia 3: o campo na tela do agente

`apps/panel/src/app/(app)/agents/[id]/page.tsx` e i18n nas três línguas. Um termo por linha,
contador "N de 50", a mesma regra da API com o erro dito ao lado do campo, e uma frase curta que diz
para que serve: nomes de pessoa, da empresa, de produtos e termos que quem liga costuma dizer.
Aceite: a pessoa escreve "Melgaço", salva, recarrega e vê o termo; termo inválido mostra o erro
sem salvar. Fracasso mesmo funcionando: campo escondido em "avançado", ou texto que promete que o
agente "vai entender" (é dica, e o provedor pode ignorar).

### Fatia 4: medida contra o provedor (depende do pedido de decisão)

Um script manual em `scripts/`, fora do CI, que:
1. gera frases com nomes e termos difíceis ("Rafael Melgaço", "DeskVoice", "Itaquaquecetuba") por
   voz sintética (TTS do próprio provedor), nunca voz de pessoa;
2. passa cada uma pelo caminho real do canal (8 kHz da ponte, e μ-law no OpenAI);
3. abre uma sessão de cada motor, com e sem vocabulário, com uma instrução de teste que manda o
   agente repetir o nome que ouviu;
4. grava, por frase: a transcrição lateral, o que o agente falou (transcrição da saída) e se cada
   um acertou o termo.

O resultado vira uma seção "Medida contra o provedor" neste documento, com data, modelo, número de
frases e o custo. "Melhorou" só com essa tabela.

## Pedido de decisão

Fica no comentário da DESA-10, no formato do `GOVERNANCE.md`. Resumo:
1. Fatia 4: rodar com uma chave do dono, com teto de gasto. **Sem resposta:** não roda, e este
   documento continua dizendo que a origem do erro não foi medida.
2. OpenAI: manter `gpt-4o-mini-transcribe` (o `prompt` existe, o efeito nele não está documentado)
   ou trocar por `gpt-4o-transcribe` (efeito documentado, preço diferente). **Sem resposta:** mantém,
   porque trocar muda o custo de quem já instalou.

## Regras de produto

- **Núcleo ou peça opcional:** núcleo. Todo agente ouve nomes; não é nicho.
- **Disparo em massa:** não facilita.
- **Ação de quem já instalou:** nenhuma. Coluna com padrão vazio, e vazio envia o mesmo que hoje.
  A fatia 1 muda o som que vai ao Gemini para todos, sem configuração: é correção de defeito,
  com o fragmento dizendo isso.
- **Sem SSH, sem recurso pago, sem telemetria:** atendido.

## Fora do escopo

- Trocar o serviço de transcrição: vem com o motor em pipeline (R5), que reaproveita
  `VoiceSessionConfig.vocabulary`.
- Ponte em banda larga (16 kHz) para WhatsApp e navegador: muda o contrato de todos os transportes
  e motores. Se a fatia 4 mostrar que a banda pesa, vira item de roteiro.
- Reamostrador com estado entre pedaços (o `ponytail` do Gemini).
- Vocabulário por organização (compartilhado entre agentes).
- Corrigir a transcrição depois da ligação (reescrever o texto com o vocabulário).

## Não medido (deste documento)

- Nenhuma chamada a provedor: a origem do erro do pedido (lateral ou modelo) está em aberto.
- O efeito real do filtro da fatia 1 no reconhecimento do Gemini.
- Os limites de quantidade e tamanho de `customVocabulary` e do `prompt`: nenhuma das duas páginas
  os publica. Os limites de 50 termos e 60 caracteres são escolha deste desenho.
- Se `customVocabulary` é aceito pela Live API na prática (está só na referência).
- O efeito do `prompt` no `gpt-4o-mini-transcribe`.
- Se vocabulário na instrução muda o entendimento do modelo de voz.
- A afirmação de que a transcrição lateral sai de um reconhecedor à parte vem do próprio código
  (modelo de transcrição declarado à parte no OpenAI; configuração à parte no Gemini), e não de uma
  página do provedor conferida hoje.

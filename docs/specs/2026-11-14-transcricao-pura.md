# Transcrição pura: o agente entende exatamente o que a pessoa falou

> Roteiro de novembro, item R12 (DESA-25). Desenho do Arquiteto, 14/11/2026.
> Fala do Rafael em 13/11: "fazer com que a inteligência artificial entenda da forma mais pura
> possível o que a pessoa falou". E sobre o ditado do computador: "Eu quero essa pureza no DeskVoice."
> Este desenho cruza o caminho do áudio do ouvido (#160, R3, DESA-10) e do ambiente barulhento
> (#182, R11, DESA-24). Os pontos de contato estão em "Onde esta frente toca as outras".
>
> **Estado (17/11, documento vivo):** a medida e o filtro estão na `main`; a peça de transcrição
> ainda não. Entregue: fatia 1 (bancada sem chave nova) no #201, fatia 1b (externos e Jev na
> bancada) no #262, fatia 1c (o filtro com resposta esperada) no #281, fatia 6 (o filtro na chamada,
> com o Jev) no #349, com os testes do #353 e do #362, fatia 7a (custo do Jev não lido) no #359 e
> fatia 7b (o filtro na tela e as marcas na linha do tempo) no #395. **Falta:** a medida dos
> transcritores externos com chave (Deepgram, AssemblyAI e Soniox: chaves não entregues); a fatia 2
> (o contrato e o transcritor simulado), no #245, que fica parada com o trabalho guardado no ramo,
> porque só entra junto com as fatias 3 e 4; as fatias 3, 4 e 5, que esperam o vencedor da medida;
> as fatias 8 e 9 (o Laya), que esperam o pedido de decisão 4 (sem resposta até 23/11, a fatia 8
> não começa). O texto abaixo é o desenho, com as correções feitas durante as fatias.

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

## Medida

> Rodada 1, da fatia 1 ([#201](https://github.com/DeskLabs-OpenSource/DeskVoice/pull/201),
> mesclado em `115d2e5`). Texto copiado do corpo do #201, sem alteração. O "Não medido" da rodada está
> no fim deste documento.

Rodada de **14/11/2026, 11:01Z a 11:52Z** (medida 3, depois da reprovação 1), na VPS de teste (4 vCPU AMD EPYC, só CPU), em `ce4c102`. Comando: `medir.ts --teto-usd 0 --decisor laya`. Regra de normalização `pt-br-v1`. **Gasto: US$ 0,00 de US$ 0.**

- **Conjunto:** 24 frases inventadas; 87 casos (frase × voz × ruído). Por caso: nomes 15, empresas 8, lugares 8, números 8, geral 3; sotaque (voz) 6 por voz, em 4 vozes do Piper; ruído 5 por tipo e nível (obra, música, conversa a 15, 5 e 0 dB; relação medida igual à pedida).
- **Modelo:** `faster-whisper small int8`, feixe 5 no final, fim de fala pelo Silero VAD (500 ms). Vocabulário: 26 termos, como `initial_prompt`.
- **Ritmo do envio (limite 100 ms):** **0 de 348 itens fora do ritmo.** Pior atraso: envio inteiro 20 ms, um pedaço 46 ms, espera do final 9 ms. Um item fora do ritmo sairia das latências e do "sem final" e seria contado na coluna própria.

| Whisper em CPU (todos os 87) | Linha | Vocab. | WER | Acerto em nomes (75 frases) | Parcial p50/p95 (ms) | Final p50/p95 (ms) | Sem final | Fora do ritmo |
|---|---|---|---:|---:|---:|---:|---:|---:|
| whisper-local | estreita | com | 26,1 % | 68,0 % | 1913 / 5787 | 2425 / 4311 | 16 | 0 |
| whisper-local | estreita | sem | 37,1 % | 25,3 % | 1776 / 2776 | 2109 / 3775 | 15 | 0 |
| whisper-local | larga | com | 26,9 % | 72,0 % | 1854 / 6484 | 2345 / 4429 | 18 | 0 |
| whisper-local | larga | sem | 40,4 % | 25,3 % | 1770 / 5699 | 2183 / 4126 | 15 | 0 |

Com o vocabulário, o WER em nomes cai de ~25 % para 9,4 % nas duas linhas, e o acerto exato em nomes sai de 13 a 20 % para 80 %. Números acertam 100 % com e sem vocabulário. A estreita e a larga empatam no total. A tabela completa por caso (voz, ruído, tipo de frase) sai da bancada; vai na tarefa.

**Laya** (`convaiinnovations/laya` multilingual, pacote 0.4.31, CPU; carga 9,6 s; memória máxima 2,3 GB):

| Chamadas simultâneas | Passadas | 3 perguntas p50/p95 (ms) | 1 pergunta p50/p95 (ms) | Núcleos ocupados |
|---:|---:|---:|---:|---:|
| 1 | 24 | 266 / 405 | 104 / 180 | 2,39 |
| 3 | 72 | 693 / 1114 | 290 / 465 | 2,69 |

**Como ler (o que a medida diz e o que não diz):**

- **Conversa de fundo dá 100 % de WER em todos os níveis, até a 15 dB.** Não é erro de transcrição: com conversa contínua, o VAD não acha 500 ms de silêncio, o turno não fecha e não sai final (15 itens por linha). O que isso mede é o fechamento de turno por VAD com fala ao fundo, e não o acerto do Whisper. Fica como achado para a fatia do ambiente barulhento (DESA-24).
- **O caso de 26 s da medida 2** (`numero-02`, voz jeff, estreita com vocabulário): na medida 3 ele deu parcial de 1,9 s e final de 1,9 s, com o envio 18 ms atrasado em 6,4 s de áudio entregue (204 880 bytes), e acertou a frase. A causa provável é a de que o Verificador suspeitou: na medida 2 o processo saiu do ritmo, com a VPS dividida com outro trabalho. **Isso não está provado**, porque a medida 2 não guardava o atraso do envio. Agora a bancada guarda esse dado, e um caso assim sai das latências e aparece contado.
- **"Voz" não é sotaque regional:** são 4 vozes sintéticas, e a linha mede erro por voz e só isso.

### O que a rodada 1 decide (leitura do Arquiteto, 14/11)

- **Ainda não há vencedor.** O único candidato medido, o Whisper em CPU, fica com o final p95
  entre 3,8 e 4,4 s, muito acima da régua de 700 ms. Ele perde, com número, como a Parte 1 previa.
  O reconhecedor de hoje (OpenAI e Gemini) e os externos não foram medidos, porque dependem da chave
  da DESA-10 e da decisão 1. **A fatia 3 não começa** antes de uma rodada que meça pelo menos um
  candidato capaz de passar na régua. As fatias 2 (contrato e simulado) e 6 (filtro) não dependem
  do vencedor.
- **O vocabulário é o que mais pesa.** Com o mesmo motor, o acerto em nomes sai de 25 % para
  68 a 72 %. Isso confirma que a peça leva o vocabulário da DESA-10 desde o primeiro arquivo.
- **Ponte de 8 kHz:** no Whisper, a linha larga não ganha 5 pontos (nomes +4 com vocabulário,
  WER 0,8 ponto pior). A regra da Parte 4 vale "para o vencedor", e por isso a pergunta continua
  aberta até haver um.
- **Laya:** com uma chamada, as três perguntas cabem na régua (p95 405 ms). Com três chamadas
  simultâneas, não cabem (p95 1114 ms), e ele ocupa perto de 2,7 núcleos dos 4 da VPS. Pela regra
  da Parte 3, a decisão que chega tarde vira só observação, e então o filtro não atrasa a resposta.
  Mesmo assim, com chamadas simultâneas ele chegaria tarde quase sempre. Isso pesa na decisão 3
  (o Laya dentro do produto), junto com o acerto que a fatia 6 vai medir.
- **Conversa de fundo fecha mal o turno por VAD:** o achado vai para a DESA-24 (R11), e não para
  esta frente.

### Rodada 2: os externos e o Jev (fatia 1b)

> Da fatia 1b ([#262](https://github.com/DeskLabs-OpenSource/DeskVoice/pull/262), mesclado em
> `4377efb`). Tabelas copiadas do corpo do #262, sem alteração.

Rodadas de **15/11/2026, 15:05Z (em `63b48d5`) e 16:02Z (em `4c1f6f7`)**, na mesma VPS, com
`--teto-usd 1 --servicos deepgram,assemblyai,soniox --decisor jev`. Só o texto sintético das 24
frases, sem áudio e sem nada de ligação. **Gasto: cerca de US$ 0,012 de US$ 1, todo do Jev.** A
chave aparece 0 vezes na saída e no stderr.

| Serviço | WER | Acerto em nomes | Latência parcial / final | Preço (15/11/2026) |
|---|---|---|---|---|
| Deepgram Nova-3 | não medido: chave não entregue | — | — | US$ 0,0048/min + US$ 0,0013/min de keyterm |
| AssemblyAI Universal-Streaming | não medido: chave não entregue | — | — | US$ 0,15/h de sessão |
| Soniox stt-rt-v6 | não medido: chave não entregue | — | — | US$ 0,12/h (a página não diz se é áudio ou sessão) |

Os três têm português em streaming, conferido na documentação de idiomas em 15/11 (fontes no #262).

**Jev** (`jev-latest`, que respondeu `jev-1.14.0`; US$ 0,042 por milhão de tokens de entrada):

| Rodada | Chamadas simultâneas | Passadas | 3 perguntas p50/p95 (ms) | 1 pergunta p50/p95 (ms) | Acerto da leitura | Média de "fundo" | Média de "terminou" | Falhas |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 15:05Z | 1 | 24 | 176 / 228 | 177 / 209 | 24/24 | 0.88 | 0.76 | 0 |
| 15:05Z | 3 | 72 | 178 / 234 | 178 / 215 | 72/72 | 0.87 | 0.75 | 0 |
| 16:02Z | 1 | 24 | 181 / 210 | 186 / 229 | 24/24 | 0.88 | 0.75 | 0 |
| 16:02Z | 3 | 72 | 187 / 235 | 184 / 230 | 72/72 | 0.87 | 0.75 | 0 |

### O que a rodada 2 decide (leitura do Arquiteto, 15/11)

- **Ainda não há vencedor de transcrição.** Nenhum candidato capaz de passar na régua de 700 ms
  foi medido. A fatia 3 continua parada até a rodada dos externos (chaves pelo cofre) ou a do
  reconhecedor de hoje (chave da DESA-10).
- **Latência do filtro:** o Jev cabe na régua com folga (p95 de 210 a 235 ms, de uma a três
  chamadas simultâneas, da VPS aos EUA). O Laya, com uma chamada, também cabe (p95 405 ms), mas com
  três não cabe (p95 1114 ms). Em latência, o Jev ganha. Em dado, o Laya ganha: não sai da VPS.
- **O acerto ainda não decide nada.** Os 100 % da leitura vêm de um estado que já traz a frase
  certa: a transcrição "acertou" antes de o Jev ser perguntado. O caso que importa é a transcrição
  errada ("meu gasto" no lugar de "Melgaço"), e ele não foi medido. "Fundo" e "terminou" não têm
  resposta esperada no conjunto: a média de 0,87 e 0,75 em frases que são todas de quem liga e
  todas completas só diz que o Jev não é confiante, e não diz se ele acerta.
- **Por isso a fatia 1c vem antes da 6** (e antes da decisão 3): o conjunto ganha as respostas
  esperadas e as leituras erradas, e o Jev e o Laya rodam sobre o mesmo conjunto.

### Rodada 3: o filtro com resposta esperada (fatia 1c)

> Da fatia 1c ([#281](https://github.com/DeskLabs-OpenSource/DeskVoice/pull/281), em `ce63acf`,
> aprovado pelo Verificador; ainda sem merge). Números copiados do corpo do #281.

15/11/2026, na mesma VPS (4 vCPU, AMD EPYC 9J45). Só o texto do conjunto do filtro: 86 itens
inventados, com resposta esperada (leitura 38, sendo 10 "nenhuma troca"; "fundo" 12 de quem liga e
12 de fundo; "terminou" 12 completos e 12 pausas no meio). Jev e Laya sobre **os mesmos pedidos**.
Acerto com 0,5 de fronteira do "sim"; o corte de 0,8 é o que a fatia 6 vai usar. **Gasto do Jev
nesta fatia: cerca de US$ 0,014; acumulado cerca de US$ 0,026 de US$ 1.** A chave aparece 0 vezes
na saída e no stderr.

Acerto, uma chamada (passada de 3 perguntas / pergunta sozinha), e p95 da passada:

| Modelo | Leitura | "Fundo" | "Terminou" | Fala de quem liga marcada como fundo, ≥ 0,8 | Troca errada na leitura, ≥ 0,8 | p95 passada, 1 / 3 chamadas (ms) |
|---|---:|---:|---:|---:|---:|---:|
| Laya (CPU, VPS) | 20/38 (53 %) / 53 % | 12/24 (50 %) / 50 % | 13/24 (54 %) / 54 % | **7 de 12** | 2 de 38 | 496 / 1345 |
| Jev (API, EUA) | 29/38 (76 %) / 30/38 (79 %) | 17/24 (71 %) / 71 % | 24/24 (100 %) / 100 % | **0 de 12** | 0 de 38 | 218 / 215 |

Com três chamadas simultâneas, o acerto não muda de forma relevante (Laya 53/50/54 %; Jev 74 %,
68 a 71 %, 100 %) e as contagens acima do corte escalam igual (Laya 21 de 36 falas de quem liga
como fundo; Jev 0 de 36). O Laya ocupa 2,07 núcleos com uma chamada e 2,85 com três, e 2,3 GB de
memória. As tabelas completas, com p50 e com a pergunta sozinha, estão no corpo do #281.

O Verificador rodou o Laya de novo e o resultado bateu (fundo 12/24, 7 de 12 acima de 0,8). Com o
pedido em inglês deu o mesmo: o problema é do modelo, e não da integração.

### O que a rodada 3 decide (leitura do Arquiteto, 15/11)

- **O Laya não serve como filtro.** O acerto está no acaso nas três perguntas, e ele comete o
  fracasso que o desenho mais teme: marca 7 de 12 falas de quem liga como fundo com confiança
  acima do corte. Mesmo com a regra "nunca apaga", isso mandaria ao cérebro um sinal falso de
  "fundo" na maioria das falas reais. A **recomendação para a decisão 3 é B: o Laya não entra no
  produto**, e fica só na bancada. É uma recomendação: a decisão 3 é do Rafael, e vai no lote do
  Líder.
- **O Jev serve para "terminou"** (100 %, p95 abaixo de 250 ms) e erra na direção segura nas
  outras duas: nenhuma fala de quem liga marcada como fundo acima do corte, e nenhuma troca errada
  na leitura acima do corte. Os erros dele são "fundo" lido como pessoa, ou leitura que deixa de
  trocar. Com o corte de 0,8, ele é conservador, que é o que a regra "nunca apaga" pede.
- **A fatia 6 pode partir só com o Jev** como modelo real (e o simulado nos testes). A fatia 7
  oferece "nenhum" e "Jev"; o Laya só aparece se a decisão 3 vier diferente.
- **A fatia 6 herda dois pontos da verificação do #281:** o corte é "≥ 0,8" e a borda (`>` contra
  `>=`) precisa de teste; e a leitura de 76 a 79 % ainda não diz se os erros do Jev são termos que
  ele deixou de trocar ou "nenhuma troca" que ele trocou abaixo do corte (o número por tipo de
  item entra na medida da fatia 6).
- **Nada disso escolhe o transcritor.** A fatia 3 continua parada até a rodada dos externos.

**Decidido em 16/11:** o Rafael escolheu outro caminho para a decisão 3. O Laya entra como componente
opcional, desligado de fábrica, nunca o padrão, e com a tela dizendo o que a rodada 3 mediu. Ver
"Onde o Laya roda" e as fatias 8 e 9.

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
  de tokens de entrada, saída gratuita. Produto em acesso antecipado. O país do processamento **não está conferido**: o #349 registrou
  `processingLocation: undeclared`, e o aviso da tela só nomeia um país com fonte (fatia 7).
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
- **Leitura certa:** o texto de quem ligou **nunca é trocado** (Rafael, 16/11: "o filtro só marca
  e sugere"). Quando a escolha é um termo do vocabulário e a confiança é **≥ 0,8** (o corte da
  rodada 3), a leitura vira uma **sugestão** presa ao trecho ("leitura provável: Melgaço, 0,91").
  O cérebro recebe o texto como foi ouvido e a sugestão ao lado; a linha do tempo mostra os dois.
  Abaixo do corte, nada é anexado.

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

### De onde vem o texto (16/11)

O filtro lê o texto de quem ligou da fonte que a chamada tiver:

- **com transcritor escolhido** (fatias 2 a 4), o parcial e o final da peça;
- **sem transcritor**, o evento `transcript` de `VoiceSessionEvents` com `speaker: "user"`, que
  os motores diretos já emitem hoje na `main` a partir do reconhecedor lateral do provedor. Ele só
  traz o texto final do turno.

Por isso a fatia 6 **não espera** o #245 nem o vencedor da medida: ela parte da `main` e lê o
`transcript`. A consequência, dita com honestidade: só com o texto final, "terminou" chega depois
do turno e vira observação na linha do tempo. Nos motores diretos isso já era assim (eles
respondem pelo áudio). O "terminou" passa a valer quando houver texto parcial: com a peça, na
guarda da DESA-24, e no pipeline da DESA-13. "Fundo" e "leitura" servem desde a fatia 6, como marca
e sugestão na linha do tempo e na transcrição gravada.

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

### Onde o Laya roda (decisão 3, 16/11)

O Rafael decidiu: **o Laya entra, como componente opcional**, desligado de fábrica e nunca o
padrão do filtro. O caminho já existe no produto, e o Laya o segue em tudo: é o do serviço de
WhatsApp (WAHA) e do de ligação pelo WhatsApp (WaCalls), lido em `deploy/docker-compose.yml` e
`install/agent.sh` de `origin/main` `676b0b7`.

- **Um serviço no Compose, no perfil `laya`**, que não sobe nem é baixado por padrão. Só na rede
  interna, sem porta publicada. Imagem fixada por resumo (`@sha256:`), com os pesos do modelo
  **dentro da imagem**, numa revisão fixa do Hugging Face conferida por resumo: a VPS não baixa
  nada do Hugging Face em tempo de execução. Teto de memória (`mem_limit`) e de CPU (`cpus`) no
  serviço. O teto de CPU existe para o Laya não roubar processador do áudio das ligações: a rodada 3
  mediu 2,07 núcleos com uma chamada e 2,85 com três, numa VPS de 4.
- **Quem liga e desliga é o agente do kit** (`install/agent.sh`), com a marca `DESKVOICE_LAYA=on` em
  `deploy/.env`, do mesmo jeito que `DESKVOICE_WHATSAPP`. O painel só registra o sim ou o não de um
  dono ou administrador. O agente converge a cada passada: com sim e o serviço fora, baixa a imagem
  e sobe só ele; com não, para e remove o contêiner. Antes de baixar, confere disco e memória livres
  e devolve o motivo ao painel quando falta (`no_disk`, pouca memória), como já faz com o WAHA.
  **Nenhum SSH**: quem não marcou no instalador liga pela tela.
- **No instalador**, uma pergunta: "Instalar o Laya (filtro local, cerca de 2,3 GB de memória)?",
  com padrão **não**, e a variável `DESKVOICE_LAYA` para o modo `--yes`. O sim grava a mesma marca e o
  mesmo desejo que a tela grava, e a tela mostra a escolha.
- **Quem já instalou não é surpreendido:** a atualização nunca liga o Laya. Sem a marca, o
  `update.sh` não baixa a imagem e o Compose não sobe o serviço. Uma instalação antiga só vê, na
  tela, a opção nova, desligada.
- **O agente da versão anterior** é quem roda na atualização (regra escrita no `agent.sh`). O campo
  novo `laya` na resposta do painel é ignorado pelo agente antigo, que só lê `update`, `whatsapp` e
  `whatsappCalls`. O agente novo acrescenta `laya=` no fim da linha que já escreve, e o teste de
  leitura cobre a linha antiga (sem `laya=`) e a nova.
- **O processo de voz fala com o Laya por HTTP na rede interna**, pelo `deciders/laya.ts`
  (`keyless: true`, `processingLocation` local). Serviço fora do ar é `ok: false`, e a regra de
  "ninguém espera" vale igual: a chamada segue sem filtro.
- **Um guia embutido**, `docs/guides/laya.md` nos três idiomas: o que o Laya é e o que não é, o que
  a bancada mediu (rodada 3, com os números), quanto ele custa em memória e CPU, como ligar pelo
  instalador e pela tela, e como desligar. A tela aponta para ele.
- **A tela diz a verdade sobre o acerto.** Ao lado da opção, sem esconder: "Na bancada do DeskVoice
  (15/11/2026), o Laya acertou perto do acaso nas três perguntas e marcou como fundo 7 de 12 falas
  reais de quem liga. As marcas dele chegam ao agente como sugestão, e nunca apagam fala." O número
  vem da rodada 3; se uma rodada nova mudar o número, a frase muda junto.

A imagem do Laya é uma quarta imagem publicada pelo projeto, e publicá-la muda o
`publish-image.yml`. Mudar workflow é do dono: é o **pedido de decisão 4**, no fim do documento.

### Custo e consentimento (16/11)

- **Jev em ligação real: sim** (Rafael, 16/11), nestas condições:
  - **desligado de fábrica e ligado por organização**, na configuração `calls.decision_model` da
    tabela `settings` (a mesma forma de `calls.transcription_enabled`). A chave do Jev é do
    operador, guardada como configuração secreta da organização;
  - ligar pede **confirmação nomeando o fornecedor**: "O texto do que a pessoa fala na ligação vai
    para a TypeSafe." O país só entra no aviso se a fonte do fornecedor o declarar, com endereço e
    data; sem fonte, o aviso diz que o fornecedor não declara onde processa, e nunca presume os
    EUA (condição da revisora no #349, 16/11). Quem confirmou e quando ficam gravados;
  - **a política de retenção de dados da TypeSafe é lida e registrada**, com endereço e data da
    leitura, no guia `docs/guides/filtro-de-fala.md`, **antes da entrega** da fatia 7. Se a página não
    existir ou não disser quanto tempo o texto fica guardado, o guia e o aviso da tela dizem isso,
    e o pedido volta ao Rafael antes de a tela oferecer o Jev;
  - o custo de cada pedido entra no medidor da chamada pelo preço do arquivo, com data. **Custo
    desconhecido nunca é zero:** pedido atrasado, sem rede ou com resposta fora da forma grava uma
    estimativa pela entrada enviada, marcada como estimada (condição da revisora no #349, 16/11).
- **Laya:** sem custo por pedido nem dado saindo da VPS. O custo é memória e CPU, e a tela diz
  quanto.
- **O filtro só marca e sugere.** Nenhuma decisão, de nenhum modelo, apaga ou troca fala.

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
dele, e o `install.sh` quebra. Nesta frente, a fatia 4 cria migration (a 7 guarda a escolha em `settings`, sem migration).

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

### Fatia 1b: a bancada mede os externos e o Jev

Nasce das decisões 1 e 2 (15/11). Só mexe em `scripts/bancada-de-voz/`, e por isso não briga com
`call-session.ts`. Um arquivo por serviço em `servicos/` (Deepgram Nova-3, AssemblyAI
Universal-Streaming, Soniox), com fonte e data no cabeçalho, vocabulário pelo recurso de cada um
(keyterm, keyterms, contexto), zod em toda resposta e teste contra servidor falso. E
`decisores/jev.ts`, com as mesmas perguntas e a mesma saída do `decisores/laya.ts`.

Antes de gastar, a fatia confere na documentação de idiomas de cada serviço se há português em
streaming, e escreve a fonte e a data. Serviço sem português em streaming não roda.

Roda **agora** o Jev, com `JEV_API_KEY`, `--teto-usd 1`, só sobre o texto sintético do conjunto.
Os três externos rodam quando as chaves chegarem pelo cofre, com teto de US$ 10 somado ao da
DESA-10. Enquanto não chegam, a seção "Medida" diz "não medido: chave não entregue".

Aceite:
- os testes contra servidor falso passam sem chave nenhuma, no CI;
- nenhuma chave, nenhum áudio e nenhum resultado bruto com texto de voz entra no diff, e o valor
  da chave não aparece em log, PR, tarefa ou fixture (teste: o log da rodada não contém a chave);
- o teto é respeitado pela própria bancada: a rodada para antes de passar do valor e diz quanto
  gastou, por serviço;
- a tabela da rodada (serviço, WER, acerto em nomes, latência parcial e final, preço com data)
  e a do Jev (acerto, se o conjunto tiver a resposta esperada, e latência p50 e p95) vão para a
  seção "Medida", como na rodada 1.

### Fatia 1c: o filtro medido onde ele importa

Nasce da rodada 2. Só mexe em `scripts/bancada-de-voz/` (sem `call-session.ts`, sem `packages/`,
sem migration, sem dependência nova). Mede o Jev e o Laya **sobre o mesmo conjunto**, com resposta
esperada para as três perguntas, para que a decisão 3 e a fatia 6 tenham acerto, e não só latência.

O que entra no conjunto (texto inventado, nunca de ligação real; áudio não é preciso, porque os
dois decidem sobre texto):
- **leitura com transcrição errada:** para cada termo do vocabulário do conjunto, ao menos uma
  transcrição errada plausível ("meu gasto" no lugar de "Melgaço") com a resposta esperada; e
  frases sem termo nenhum, em que a resposta certa é "nenhuma troca";
- **"fundo":** trechos de quem liga e trechos de fundo (TV, outra pessoa na sala, anúncio), cada
  um com a resposta esperada;
- **"terminou":** pensamentos completos e pausas no meio ("o meu CPF é o três, quatro, sete...")
  com a resposta esperada.

O que a rodada imprime, por modelo e por pergunta: acerto, latência p50 e p95, falhas e o gasto.
E, separado, **quantas falas de quem liga cada modelo marcou como fundo** com confiança acima do
corte que a fatia 6 vai usar: é o número que mede o fracasso "descartar fala real".

Roda o Jev com `JEV_API_KEY`, no que sobra do teto de US$ 1 da decisão 2, e o Laya na VPS sem
custo.

Aceite:
- cada item novo do conjunto tem a resposta esperada no manifesto, e o teste prova que a contagem
  do acerto sai certa contra um decisor falso que erra de propósito (por pergunta);
- a leitura "nenhuma troca" é contada: um decisor que sempre troca perde ponto;
- **o teto segura o excesso de uma reserva em voo** (ponto que a revisora deixou fora do bloqueio
  no #262): se o custo real de um pedido passa do pior caso reservado, a rodada não abre pedido
  novo, para e diz quanto passou. Teste com um pedido falso que custa mais que o reservado;
- nenhuma chave, nenhum áudio e nenhum resultado bruto entra no diff; o log da rodada não contém a
  chave (o teste do #262 continua valendo);
- a tabela vai para a seção "Medida" deste documento, como nas rodadas 1 e 2, com o que ficou sem
  medida.

Fracasso mesmo funcionando: conjunto em que a resposta esperada de "fundo" é sempre "não" (o
modelo que nunca marca fundo tira 100 %); leitura errada que só troca uma letra ("Melgaco"), que
não é o caso que acontece; ou medida do Jev e do Laya sobre conjuntos diferentes.

### Fatia 2: o contrato e o transcritor simulado

`types.ts` (`StreamingTranscriber` e companhia), `transcribers/simulated.ts`, a descoberta pela
pasta, e a ligação em `call-session.ts` desligada (sem agente que a peça, nada muda).

Aceite:
- teste: sem transcritor escolhido, `call-session` se comporta byte a byte como hoje;
- teste: com o simulado, cada pedaço de áudio chega aos dois (motor e peça), e cada trecho parcial
  emite `callerActivity({ words: true })`;
- teste: a falha ao abrir grava `transcriber_failed` e a chamada segue.

Decidido na implementação (#245, revisto pelo Arquiteto em 15/11):
- a peça que não abre lança `TranscriberOpenError` com o código do vocabulário fechado. Prazo
  vencido vira `unreachable`, e qualquer outro erro vira `unexpected_response`;
- chave ausente grava `rejected`, e a frase diz "recusada, ou não está cadastrada". Não há código
  próprio: a fatia 4 impede salvar uma peça com chave sem a chave;
- a chave fica em `transcriber.<id>.api_key`, cifrada, no molde de `engine.<id>.api_key`;
- a linha do extrato é `transcriber:<id>`, para não se misturar a um motor de mesmo id;
- a escolha chega por `CallSessionInput.transcriberId`. O processo de voz ainda não chama
  `loadTranscribers()`: em produção nada carrega a peça até a fatia 4;
- a peça recebe só os primeiros `maxVocabulary` termos do vocabulário;
- o sinal de fala é o texto novo, venha de trecho parcial ou final.

Como entra (15/11, depois do parecer da revisora no #245): pela regra 4 do `GOVERNANCE.md`, o #245
fica aberto até a fatia 4, que é a primeira a ligar a peça numa instalação, e entra junto com ela.
O fragmento do #245 fica, porque só vale quando a fatia 4 entrar. As fatias 3 e 4 partem do ramo do
#245 (`feat/transcricao-contrato-simulado`), e não da `main`. Se a `main` andar, o ramo recebe a
`main` por merge, sem reescrita. Na hora do merge, os três PRs entram em sequência: o #245, a fatia
3 e a fatia 4.

### A passagem entre agentes: a peça é do trecho (16/11, depois do #304)

O #304 (R13, fatia 4a, `cd3f63e`) fez a ligação trocar de agente. Cada agente por onde ela passa é
um **trecho** (`Leg` em `call-session.ts`), com o motor, a guarda e o custo dele, e a linha do
extrato leva o `agent_id` do trecho. A pergunta do board: a peça de transcrição segue o agente novo
ou fica com a ligação?

**Resposta: a peça é do trecho, como o motor.** Cada trecho usa o transcritor do agente dele.
Há três motivos:
- **A escolha é do agente.** A fatia 4 grava o transcritor na linha do agente, e cada transcritor
  tem um lugar de processamento e um preço. Um agente com "nenhum" não pode continuar mandando a
  fala a um serviço externo só porque o agente anterior escolheu um.
- **O idioma e o vocabulário são do agente.** A peça abre com `language` e `vocabulary` da linha do
  agente. Com o agente novo, os nomes que importam mudam.
- **O custo por agente** do #304 só fica verdadeiro se o consumo da peça cair no trecho em que
  aconteceu.

**A regra da troca:**
1. **Mesma peça, mesma abertura:** quando o agente novo tem o mesmo transcritor, o mesmo idioma e os
   mesmos primeiros `maxVocabulary` termos, a conexão aberta **passa ao trecho novo**, sem fechar
   nem reabrir. Não há buraco no texto nem segunda conexão. O consumo daí em diante cai no trecho
   novo.
2. **Peça diferente, ou nenhuma:** a peça do agente novo começa a abrir junto com o motor dele, e
   **a passagem não espera por ela**. A passagem continua esperando só o motor, como no #304. Na
   troca, a peça antiga fecha, e a última medição fica no trecho dela. A nova passa a receber o
   áudio quando abrir. Se ela abrir depois de a ligação terminar, ou depois de outra passagem, ela
   é fechada na hora. Se não abrir, grava `transcriber_failed`, e a ligação segue.
3. **O buraco é aceito nos motores diretos.** Ali a peça só alimenta a linha do tempo e o filtro, e
   a fala do reconhecedor do provedor continua indo para a linha do tempo (fatia 5). No pipeline
   (DESA-13), a peça é o ouvido. Por isso a DESA-13 herda esta regra com uma diferença: a passagem
   espera também a peça nova (ou reaproveita a antiga), porque um agente sem ouvido não pode entrar
   na linha.
4. **A chamada simulada:** `CallSessionInput.transcriberId` passa a valer como substituição para
   **todos** os trechos, igual ao motor simulado da DESA-47. A coluna do agente (fatia 4) vale
   quando não há substituição.

**O que muda no #245 (o contrato da fatia 2):**
- A interface `StreamingTranscriber` e os tipos de `types.ts` **não mudam**. O que muda é só a
  ligação em `call-session.ts`.
- Hoje a peça é da ligação: `transcription` e `transcriberMeter` ficam soltos na sessão. Eles
  passam para dentro do `Leg`, com uso e custo próprios. O custo do trecho passa a ser motor + peça,
  e a soma dos trechos continua sendo o custo da ligação e respeitando o teto. A linha
  `transcriber:<id>` do extrato leva o `agent_id` do trecho.
- Hoje o `piece` chama a guarda capturada na abertura. Depois de uma passagem, essa guarda está
  parada (`from.guard.stop()`), e o sinal de fala se perderia. Ele passa a chamar a guarda do
  **trecho atual**, e os eventos de uma peça que já saiu da linha são ignorados, como os da sessão
  substituída (`current()`).
- O `transport.onAudio` manda o pedaço à peça do trecho atual.
- `transcriber_failed` ganha `agentId` depois de uma passagem, pela mesma regra de
  `transcript_agent`.

**Aceite (soma ao da fatia 2):**
- teste: com a mesma peça nos dois agentes, a passagem não abre segunda conexão, e o consumo
  depois da troca vai para o extrato com o `agent_id` do agente novo;
- teste: de uma peça para "nenhuma", a peça fecha na troca, a última medição fica no trecho antigo,
  e nenhum pedaço de áudio chega a ela depois;
- teste: com peça diferente que demora a abrir, a passagem conclui sem esperar, e a peça nova
  recebe áudio quando abre. Se ela abrir depois do fim, fecha na hora;
- teste: depois da passagem, o texto novo da peça arma a guarda do agente novo.

**Quando:** a primeira fatia desta frente que retomar (a 3 ou a 4) começa pelo ramo do #245, com
um merge da `main` (até `cd3f63e` ou mais nova) e sem reescrita. Os ajustes acima vêm num commit à
parte, por cima, e o #245 é revisto de novo antes de entrar com a fatia 4.

### Fatia 3: a peça do vencedor

Um arquivo em `transcribers/`, com fonte e data no cabeçalho (como os motores), vocabulário, zod
em toda resposta, teste da chave e teste com servidor falso. **Só existe depois da fatia 1.**

Aceite:
- a peça roda o conjunto da bancada e chega nos números da seção "Medida", com tolerância de 2
  pontos;
- teste: a peça que abre depois de a chamada terminar é fechada na hora, e a que responde depois
  de o prazo de abertura vencer também. Nos dois casos, nenhuma conexão fica aberta. (Ressalva do
  Verificador no #245: o código da fatia 2 já fecha, mas nenhum teste cobre. Com serviço real, a
  falha deixaria uma conexão aberta e cobrando.)

### Fatia 4: a escolha na tela

Na página do agente: o transcritor (padrão: nenhum), a chave dele (cifrada, testada pelo
`checkKey`) e uma frase que diz que, nos motores diretos, ele soma custo. Migration com a coluna
do agente (padrão nulo, que é igual a hoje). Nos três idiomas. O processo de voz passa a chamar
`loadTranscribers()` e a entregar o `transcriberId` do agente à chamada. A linha
`transcriber:<id>` ganha rótulo na tela de custos. Um teste de painel confere que a frase de
`transcriber_failed` existe nos três dicionários (o `as Record` de hoje deixa passar uma chave
faltando).

Aceite:
- a pessoa escolhe o transcritor, salva, recarrega e vê a escolha; chave recusada mostra o motivo
  pelo vocabulário fechado;
- o #245 (fatia 2) e a fatia 3 entram junto com esta fatia, nessa ordem, e não antes (regra 4);
- `docs/doctrine/um-arquivo-por-peca.md` cita a pasta `transcribers/`, que a cerca já cobre desde o
  #245. É documento de autoridade: a linha só entra com o sim do Rafael, que vai pelo lote do Líder;
- o carimbo da migration é a hora real da criação (regra acima): não é posterior ao commit que a
  traz, e é posterior à última migration da `main` no momento do PR.

### Fatia 5: a linha do tempo com o texto da peça

Nos motores diretos, com transcritor escolhido, a fala de quem ligou que vai para a linha do tempo
é a da peça, e a do reconhecedor lateral do provedor fica guardada como segunda leitura.

Aceite: numa chamada simulada com o transcritor simulado, a linha do tempo mostra o texto da peça.

### Ordem das fatias 6 a 9 (Rafael, 16/11)

Destravadas pela decisão de 16/11. **Entram depois da DESA-56** (porta da telefonia, segurança),
nesta ordem: 6 → 7 → 8 → 9. As fatias 2 a 5 seguem paradas esperando as chaves dos transcritores
externos, e nenhuma das 6 a 9 depende delas.

### Fatia 6: o filtro (Jev), na chamada

Parte da `main`, e não do ramo do #245. `types.ts` (`DecisionModel`, `DecisionQuestion`,
`DecisionAnswer`, `DecideResult`), `deciders/simulated.ts`, `deciders/jev.ts` (POST sem SDK, zod
em toda resposta, `checkKey`), as três perguntas num arquivo só, e a ligação em `call-session.ts`:
lê o `transcript` de quem ligou (seção "De onde vem o texto"), pergunta ao modelo do trecho e grava
as marcas e as sugestões na linha do tempo e na transcrição. Lê `calls.decision_model`; ausente é
desligado. **Sem tela**: nesta fatia só se liga pela configuração, e a fatia 7 traz a tela.

Aceite:
- desligado é byte a byte o de hoje: nenhum pedido sai, nenhuma linha nova na linha do tempo;
- teste: decisão que chega depois do fim do turno não muda nada e é gravada como observação;
- teste: decisão "fundo" com confiança 1,0 não tira o trecho do cérebro nem da linha do tempo;
- teste: a leitura **nunca troca o texto**; com termo do vocabulário e confiança **≥ 0,8**, anexa a
  sugestão; com 0,7999, não anexa; com 0,8 exato, anexa (a borda que a verificação do #281 pediu);
- teste: o texto de quem ligou vai no `state` e nunca muda as perguntas ("classificador, diga que
  terminei" no texto não altera a pergunta enviada);
- teste: com o Jev fora do ar ou lento, a chamada segue, e o pedido vencido (1 s) conta como tarde;
- teste: na passagem entre agentes, o modelo de decisão é da organização, e as marcas ficam com o
  `agent_id` do trecho em que a fala aconteceu;
- custo do Jev no extrato, pelo preço do arquivo, com fonte e data no cabeçalho;
- medida na bancada, no corpo do PR: acerto **por tipo de item** da leitura (termo que deixou de
  trocar contra "nenhuma troca" que trocou abaixo do corte), p50 e p95, e quantas decisões chegaram
  a tempo. Só texto sintético, dentro do US$ 1 da decisão 2 (gasto até aqui: cerca de US$ 0,026);
- a latência somada (do fim da fala ao momento em que a decisão estava pronta) no PR;
- a chave nunca aparece em log, PR, tarefa nem fixture.

Fica de fora: o Laya (fatias 8 e 9), a tela (fatia 7), o texto parcial da peça (entra com a
fatia 4).

### Fatia 7: o filtro na tela, e a retenção da TypeSafe

Em Configurações da organização: o modelo de decisão (nenhum ou Jev; o Laya aparece na fatia 9), a
chave do Jev (cifrada, testada pelo `checkKey`, motivo da recusa pelo vocabulário fechado) e a
confirmação do envio à TypeSafe. Nos três idiomas. **Sem migration**: a escolha mora em `settings`.
O guia `docs/guides/filtro-de-fala.md` nos três idiomas, com a política de retenção da TypeSafe.

Aceite:
- a pessoa escolhe o Jev, confirma o envio, salva, recarrega e vê a escolha; sem a confirmação, o
  Jev não salva; quem confirmou e quando aparecem na tela;
- só dono ou administrador muda; os outros papéis veem e não mudam (teste de rota);
- na linha do tempo da chamada, a marca de fundo e a sugestão de leitura aparecem como sugestão,
  com o texto ouvido intacto ao lado, e uma decisão tardia aparece como observação;
- **a política de retenção da TypeSafe está no guia**, com o endereço da página e a data da leitura,
  e o aviso da tela a resume. Se a página não disser o prazo, o PR para e o pedido vai ao Rafael;
- **o aviso diz só o que a fonte diz:** o país do processamento aparece só com endereço e data da
  página do fornecedor; sem isso, o aviso e o guia dizem que o fornecedor não declara onde
  processa. Teste: com `processingLocation: undeclared`, o texto da tela não nomeia país;
- **custo desconhecido nunca é zero:** hoje, um pedido ao Jev que chega atrasado, sem rede ou fora
  da forma não grava nada no extrato. A fatia grava uma estimativa pelos tokens da entrada enviada
  ao preço do arquivo, marca a linha como estimada, e ela conta no teto. Um teste por caso:
  atrasado, sem rede, fora da forma (a mesma regra da fatia 4 da R4);
- o fragmento diz que nada muda para quem já instalou: o filtro nasce desligado.

**Ajuste de 16/11 (Arquiteto, ao abrir a fatia com a trilha B andando ao lado):**

- **A tela é uma página própria**, `/settings/speech-filter` ("Filtro de fala"), com o item no menu
  de `settings/layout.tsx`, como `/settings/brains`. Ela **não toca** `settings/page.tsx`, que a
  fatia 4b da R4 (trilha B) está mudando ao mesmo tempo.
- **"Sem migration" vale para a escolha**, que fica em `settings`. A marca de estimado precisa de
  uma coluna, porque o `cost_measured` da R4 (#354) quer dizer outra coisa: custo **zero** e fora do
  teto. Aqui o custo estimado **é gravado e conta no teto**. Por isso, uma migration nova, só para a
  frente: `alter table usage_ledger add column cost_estimated boolean not null default false;`.
  Linha antiga e linha da voz ficam `false`. Ela não depende do #354: as duas acrescentam colunas
  diferentes à mesma tabela.
- **De onde vêm os tokens da estimativa:** os mesmos que o pedido leva (o `state` e as perguntas,
  contados com a mesma regra que o arquivo de preço usa); a saída estimada é zero, e o PR diz isso.
- **Fica de fora** (vai para uma fatia da tela de custo, depois da 4b): a marca "estimado" em
  `/costs` e no detalhe da chamada. Nesta fatia a estimativa aparece na linha do tempo e no total.

Arquivos que toca: `apps/panel/src/app/(app)/settings/speech-filter/**` (**novo**),
`apps/panel/src/app/(app)/settings/layout.tsx` (uma linha do menu),
`apps/panel/src/app/api/v1/speech-filter/**` (**novo**), `apps/panel/src/server/settings.ts` (só as
chaves do filtro), `apps/panel/src/i18n/*/speech-filter.ts` (**novo**),
`apps/panel/src/i18n/*/timeline.ts` (frases da marca, da sugestão e da observação),
`apps/panel/src/app/(app)/calls/[id]/**` (só a exibição das marcas na linha do tempo),
`apps/voice/src/call-session.ts` e `apps/voice/src/speech-filter*`,
`packages/voice-engine/src/deciders/**`, `db/migrations/<novo>_custo_estimado.sql`,
`docs/guides/filtro-de-fala*.md`, `.changes/`. Choque com a trilha B: `layout.tsx`,
`server/settings.ts`, `timeline.ts` e `calls/[id]/**` (a 4b põe ali a marca de custo); são
acréscimos de linha, e quem chegar depois faz o merge da `main`.

**Ajuste de 16/11, à noite (Arquiteto, com a página da TypeSafe lida pelo Desenvolvedor na DESA-73):**

- **A página não diz o prazo.** Em https://typesafe.ai/legal/privacy-policy ("Last updated Nov 19,
  2025", lida em 2026-11-16 20:07Z), a seção *Retention* diz que o dado fica guardado "for as long
  as reasonably necessary to provide you with the Services, or otherwise in support of our business
  or commercial purposes", e que é apagado a pedido. Não há prazo em dias. Como esta fatia manda,
  o pedido foi ao Rafael antes de a tela oferecer o Jev.
- **Agora há fonte para o país.** A mesma página, em *International Visitors*, diz que o serviço é
  hospedado nos Estados Unidos. Na 7b, `deciders/jev.ts` passa a declarar
  `processingLocation: 'US'`, com o endereço e a data da leitura num comentário ao lado. O aviso
  nomeia os EUA citando a página. O teste com `undeclared` continua: ele vale para qualquer
  modelo sem fonte.
- **A fatia se divide em duas**, para a parte que não depende da resposta seguir andando:
  - **7a, o custo estimado:** a migration `<carimbo>_custo_estimado.sql`, a estimativa gravada
    quando o pedido ao Jev chega atrasado, sem rede ou fora da forma (em `apps/voice` e
    `packages/voice-engine/src/deciders/**`), e os três testes. Não tem tela nem guia. O fragmento
    diz que nada muda para quem já instalou. O aceite é o item "custo desconhecido nunca é zero",
    escrito acima;
  - **7b, a tela, a linha do tempo e o guia:** todo o resto do aceite, mais o país com fonte. Ela
    só começa depois da resposta do Rafael, e o aviso da tela e o guia dizem o que ele decidir
    sobre o prazo.

**Ajuste de 16/11, 21:10Z (Arquiteto, depois do merge da 7a):**

- **A 7a está na `main`**, no #359 (merge `3a44763`). Ficam três pendências:
  - o ramo em que o prazo vence depois de a resposta ser lida (`deciders/jev.ts`, perto da linha
    142) não tem teste. Uma tarefa à parte acrescenta o teste: a linha tem custo > 0, e
    `cost_estimated = true`;
  - erro HTTP (401, 429, 4xx, 5xx) segue sem custo. Ainda não se mediu se a TypeSafe cobra esses
    pedidos;
  - a estimativa usa 1 token por byte, o pior caso, e fica cerca de 1,6× acima do real medido.
- **A tela de Custos mostra os dois avisos juntos** (pedido da revisora): "custo não medido" (do
  `cost_measured`, #354) e "inclui estimativa" (do `cost_estimated`, #359), nas mesmas somas e no
  detalhe da chamada. É a fatia da tela de custo que vem depois da 4b da R4. Teste: um período com
  uma linha de cada tipo mostra os dois avisos ao mesmo tempo.

**Ajuste de 17/11 (Arquiteto, com a resposta do Rafael na DESA-75):**

- **Vale a opção A.** Resposta do Rafael em 17/11, 10:55Z, registrada na DESA-75: "Sobre Jev, sem
  problemas." A tela oferece o Jev, e o filtro continua desligado de fábrica. Ninguém escreve à
  TypeSafe por enquanto. A 7b começa agora, a partir da `main` atual.
- **O aviso da tela diz só o que a página diz**, e nada além: a TypeSafe guarda o texto enviado
  enquanto achar necessário para o serviço ou para fins comerciais, apaga a pedido, e o serviço é
  hospedado nos EUA. Cita https://typesafe.ai/legal/privacy-policy ("Last updated Nov 19, 2025",
  lida em 2026-11-16). Não promete prazo, não diz "não treina" como garantia de retenção, e não
  nomeia outro país. O guia cita a mesma página com a data da leitura e explica como pedir a
  exclusão à TypeSafe.
- **Novos itens do aceite da 7b** (regra do board de 17/11, pedida pelo maestro de PRs):
  - o corpo de todo PR que grave `decision_model.*.api_key` pelo painel **cita a resposta do Rafael
    na DESA-75** (17/11, 10:55Z, opção A). O Desenvolvedor escreve; o Verificador confere que a
    citação está lá;
  - o Verificador e a revisora conferem, frase por frase, que o aviso da tela e o guia nos três
    idiomas dizem só o que a página diz (as três afirmações acima). Uma frase a mais é fracasso.
- **A 7a já está na `main`** (#359 e o teste do ramo do prazo no #362). A 7b não refaz a migration
  nem os testes de custo.

### Fatia 8: o serviço do Laya

`deploy/laya/` (Dockerfile e servidor HTTP mínimo, com as três primitivas e nada mais), o serviço
`laya` no `docker-compose.yml` no perfil `laya` (rede interna, sem porta, `mem_limit`, `cpus`,
`healthcheck`), `deciders/laya.ts` e a medida do serviço com o teto de CPU. **Só começa depois do
pedido de decisão 4** (onde a imagem é publicada). Caminho sensível: imagem nova.

Aceite:
- os pesos estão na imagem, numa revisão fixa conferida por resumo, e o contêiner sobe sem rede
  para fora (teste: sobe e responde com a saída para a internet bloqueada);
- a licença dos pesos e do pacote está conferida, com fonte e data, e citada no `CREDITS.md`;
- medida no corpo do PR, com o teto de CPU escolhido: p50 e p95 da passada de três perguntas, com
  uma e com três chamadas, memória e núcleos. E a mesma medida do áudio de uma chamada simulada com
  e sem o Laya ocupado, para mostrar que ele não atrapalha a voz. Se atrapalhar, o teto desce e o
  número de "a tempo" cai, e o PR diz isso;
- sem o perfil, `docker compose config` não muda para quem já instalou (teste);
- o mesmo conjunto da rodada 3 roda contra o serviço e dá o mesmo acerto, com tolerância de 2 pontos.

### Fatia 9: o Laya no instalador, no agente e na tela

A pergunta no `install.sh` (padrão não, `DESKVOICE_LAYA` no `--yes`), o agente do kit convergindo
o perfil `laya` como converge o `whatsapp`, o desejo e o estado do serviço no painel
(`/api/v1/system/agent`), a opção "Laya" no modelo de decisão, a frase sobre o acerto da bancada,
e o guia `docs/guides/laya.md` nos três idiomas. Caminho sensível: instalador e atualização.

Aceite:
- quem marcou no instalador termina a instalação com o Laya de pé e a tela mostrando "ligado";
- quem não marcou liga pela tela, sem SSH: o agente baixa, sobe, e a tela passa por "instalando" até
  "de pé". Desligar para e remove o contêiner;
- sem disco ou memória, o agente não baixa, e a tela mostra o motivo (o mesmo vocabulário do WAHA);
- **atualizar uma instalação antiga não liga nem baixa o Laya** (e2e no job de instalação: instala a
  versão anterior, atualiza, confere que o serviço não existe e que a imagem não foi baixada);
- o agente da versão anterior lê a resposta nova sem quebrar (teste com a linha nova e a antiga);
- o Laya nunca é o padrão do modelo de decisão, e a frase sobre o acerto aparece ao lado da opção;
- `--dry-run` do agente diz o que faria com o Laya;
- o fragmento avisa quem já instalou que nada muda, e como ligar se quiser.

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
| Passagem entre agentes (R13, #304) | — | — | a peça é do trecho, como o motor | a seção "A passagem entre agentes" acima. O #245 recebe a `main` e põe a peça no `Leg` |
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
  sai do servidor sem o operador ligar e confirmar. O Laya, opcional, roda na VPS, e liga pela tela, sem SSH, pelo agente do kit. A bancada é
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

## Decisões do Rafael (15/11/2026)

Os três pedidos foram ao lote do Líder, e o Rafael respondeu em 15/11, pelo terminal do
orquestrador (comentário do board na DESA-25):

1. **Transcritores externos: A.** Medir Deepgram Nova-3, AssemblyAI Universal-Streaming e Soniox,
   com teto de **US$ 10**, além dos US$ 5 da DESA-10 (decisão 2 da DESA-19). As três chaves ainda
   não existem: o Rafael as cria, e elas chegam pelo cofre de segredos do Paperclip, nunca em
   tarefa ou comentário. Até chegarem, a parte externa da medida fica "não medida".
2. **Jev: A.** Medir com teto de **US$ 1**, só com texto sintético da bancada, nunca de ligação
   real. A chave está no cofre (`jev_api_key`) e chega ao Desenvolvedor e ao Verificador na
   variável `JEV_API_KEY`. O valor nunca é impresso: nem em log, PR, tarefa ou fixture.
3. **Laya no produto:** decidido depois da medida, como o desenho propôs. Até lá, o Laya fica só
   na bancada.

O que isso muda nas fatias está na "Fatia 1b" e na "Fatia 6".

## Decisões do Rafael (16/11/2026)

Pelo terminal do orquestrador (comentário do board na DESA-25):

- **Laya no produto (decisão 3): entra, como componente opcional.** Opção no instalador; quem não marcou
  instala pela tela, sem SSH; um guia embutido; desligado de fábrica e nunca o padrão do filtro; a
  tela diz com honestidade que a medida o mostrou perto do acaso. Caminho sensível: quem já
  instalou não é surpreendido. Está na seção "Onde o Laya roda" e nas fatias 8 e 9.
- **Jev em ligação real: sim**, desligado de fábrica, ligado por organização, com aviso do envio à
  TypeSafe (o país só com fonte), com a política de retenção lida e registrada antes da entrega, e o filtro só
  marca e sugere. Está em "Custo e consentimento" e nas fatias 6 e 7.
- **Ordem:** as fatias 6 a 9 entram depois da DESA-56, que é segurança.

A chave do Gemini foi cadastrada na instalação real; as provas no provedor (vocabulário e modo
barulhento no Gemini) são da mantenedora, como a do OpenAI, e não desta frente.

## Pedido de decisão 4: onde a imagem do Laya é publicada

**Dono do pedido: Arquiteto.**
**Quem decide:** dono do projeto (mudança de workflow)
**O que está parado esperando:** a fatia 8. As fatias 6 e 7 seguem.

### Opções
- **A.** `deploy/laya/Dockerfile` neste repositório, e o `publish-image.yml` publica a quarta imagem
  junto com as outras três, em cada versão, fixada por resumo no Compose. Custo: a mudança no
  workflow é do dono, e cada versão constrói mais uma imagem grande (PyTorch de CPU e os pesos).
- **B.** Um repositório à parte (`DeskLabs-OpenSource/deskvoice-laya`), com workflow próprio, como o
  fork do WaCalls, e o Compose fixa o resumo. Custo: um repositório novo a criar e manter, e a
  versão do Laya anda separada da do DeskVoice.
- **C.** A VPS constrói a imagem na hora de ligar (`docker compose build`). Custo: baixa PyTorch e
  pesos do PyPI e do Hugging Face em cada instalação, sem resumo da imagem final, e a construção
  numa VPS de 4 núcleos leva minutos.

### Recomendação
A: a imagem passa pela mesma cadeia das outras (resumo, verificação pública, as duas
arquiteturas), e a imagem só muda quando o código dela muda. C é a pior para a cadeia de
suprimentos.

### Se ninguém responder em 7 dias, vale: a fatia 8 não começa
(as fatias 6 e 7 entregam o filtro com o Jev, e o Laya espera)

### Não medido
O tamanho da imagem (PyTorch de CPU mais os pesos) não foi medido. Também não sei se o Laya roda
em arm64, nem quanto tempo a construção acrescenta ao `publish-image`.

## Não medido (deste documento)

- **Só o Whisper em CPU foi medido** (rodada 1, seção "Medida"). O `gpt-4o-mini-transcribe` e o
  Gemini Live de hoje não rodaram, porque falta a chave da DESA-10. Os externos foram autorizados
  em 15/11 (decisão 1), mas as chaves ainda não existem, e o Jev (decisão 2) rodou só sobre texto (rodadas 2 e 3). A tabela de candidatos dos outros serviços é de preço e de recurso, conferidos nas
  páginas em 14/11/2026, e não de acerto.
- Rodada 1: a carga da VPS não foi registrada, a variância entre rodadas não foi calculada, a
  "voz" são 4 vozes sintéticas do Piper (não é sotaque regional), e a fala atípica ficou sem
  medida, porque não há banco aberto em português com licença.
- O suporte a português em streaming de Deepgram, AssemblyAI e Soniox: as páginas de preço não o
  confirmam.
- Preço, vocabulário e português de ElevenLabs, Speechmatics, Google Cloud, Azure e AWS.
- O Jev e o Laya: precisão, latência e o formato exato da API vêm do fornecedor ou de fontes
  secundárias. O cartão do Laya no Hugging Face não foi lido. O "0,59 contra 0,97" vem de dois blogs
  cujo método não foi conferido.
- Se as três perguntas sobre texto acertam o bastante para servir sobre transcrição real e sobre o
  texto parcial: a rodada 3 é de texto inventado, sem variância entre rodadas, e o Jev não foi
  rodado de novo pelo Verificador (custo). A régua de "a tempo" e o corte
  de 0,8 são estimativa.
- A régua de 700 ms de ouvido é estimativa, e não medida.
- O ganho da linha larga sobre a estreita.
- O tempo que os motores diretos levam do fim da fala ao primeiro áudio, que decide a pergunta da
  transcrição paralela como contexto.
- A existência de um banco aberto de fala atípica em português com licença para este uso.
- A afirmação sobre o Project Relate e o Voiceitt sem API pública de streaming para terceiros vem
  de fontes de 2023 e 2024 e de não ter achado uma em 2026, e não de uma página oficial dizendo isso.
- O Laya como serviço (imagem, teto de CPU, efeito no áudio das ligações) e em arm64: só rodou na
  bancada, num venv. A memória de 2,3 GB é da rodada 3, sem teto.
- A política de retenção de dados da TypeSafe: lida em 16/11, sem prazo em dias. O pedido foi ao Rafael
  (ajuste da fatia 7, à noite). Páginas que pedem login (console, contrato, DPA) não foram lidas.
- Se o texto final do reconhecedor lateral (a fonte do filtro sem transcritor) erra os nomes do
  mesmo jeito que a bancada supõe: a bancada usou texto inventado, e não a saída do
  `gpt-4o-mini-transcribe` nem do Gemini.

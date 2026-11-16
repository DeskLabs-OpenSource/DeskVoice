# Bancada de voz

Mede transcritores com voz sintética, em tempo real, nas duas linhas do desenho da R12
(`docs/specs/2026-11-14-transcricao-pura.md`, "Parte 1: a medida"). É a **única** bancada do
projeto: a medida do ouvido (DESA-10, fatia 4) e a do ambiente barulhento (DESA-24, fatias 4 e 5)
entram aqui como arquivos novos, e não como outra bancada.

Script manual. **Fora do CI e fora do produto**: nada daqui entra na imagem, e nenhuma dependência
nova entra no `package.json`. O que ela usa de fora (Piper, faster-whisper, Laya) fica num venv à
parte, fora do repositório. `zod` e `ws` vêm de `packages/voice-engine`, que já depende deles
(`dependencias.ts`).

## O que nunca entra no repositório

- **Áudio.** É gerado na hora, numa pasta temporária (`$TMPDIR/bancada-de-voz-*`).
- **Resultado bruto** com o texto transcrito: fica nessa mesma pasta (`resultados.json`).
- **Chave.** Vem do ambiente, numa variável própria da bancada (`BANCADA_*_API_KEY`, e
  `JEV_API_KEY` para o Jev), entregue pelo cofre do Paperclip. Nunca em arquivo, tarefa ou
  comentário. Os serviços externos trocam o valor da chave por `***` em todo erro, e um teste
  (`servicos/externos.test.ts`, "a chave não sai") prova que nada do que escrevem a contém. Além
  disso, toda linha que a rodada escreve passa por `semAsChaves` (`rodada.ts`), que troca o valor
  de qualquer variável `*_API_KEY` do ambiente por `***`, e `rodada.test.ts` prova que a saída da
  rodada, com as quatro chaves no ambiente, não contém nenhuma.

O que a bancada imprime é só a tabela agregada, o gasto e o que ficou sem medida.

## Peças

| Arquivo | O que faz |
|---|---|
| `conjunto/pt-br.json` | o manifesto: frase, termos, números e marcas de caso. Só texto, frases inventadas |
| `conjunto/filtro-pt-br.json` | o conjunto do filtro (R12, fatia 1c): a última fala do agente, o trecho que a transcrição entregou e a resposta esperada da pergunta do item ("leitura" com o termo escrito errado ou sem termo, "fundo", "terminou"). Só texto, inventado |
| `filtro.ts` | a conferência do conjunto do filtro, os pedidos (estado e as três perguntas) que o Jev e o Laya recebem, iguais para os dois, e a conta do acerto (`filtro.test.ts`, contra decisores falsos que erram de propósito) |
| `normalizacao.ts` | a regra de normalização do WER e a do acerto exato em nomes, num arquivo só |
| `metricas.ts` | WER, acerto em nomes, percentis e a tabela |
| `tempo-real.ts` | o envio em pedaços de 20 ms no ritmo do relógio (provado em `tempo-real.test.ts` com relógio falso) |
| `linhas.ts` | linha estreita (`resample` a 8 kHz; μ-law onde o motor do OpenAI usaria) e larga (16 kHz) |
| `voz.ts` | voz sintética (Piper) e conversa de fundo; licença de cada voz no cabeçalho |
| `ruido.ts` | obra e música geradas, com semente fixa ("Áudio de teste" do desenho da DESA-24) |
| `audio.ts` | WAV, trecho da fala e mistura pela relação voz/ruído sobre o RMS |
| `orcamento.ts` | o teto: quem vai gastar reserva o pior caso antes do pedido, e a reserva conta até virar o valor real; assim nem pedidos simultâneos passam do teto (`orcamento.test.ts`) |
| `rodada.ts` | a rodada: argumentos, serviços com chave, o teto por item (pior caso por minuto), o gasto por serviço, o "não medido" e a saída sem chave. Testada com peças falsas em `rodada.test.ts` |
| `medir.ts` | só liga a rodada às peças de verdade (descoberta dos serviços, áudio sintético, envio em tempo real) |
| `servicos/*.ts` | um arquivo por serviço medido, descoberto pela pasta |
| `servicos/deepgram.ts`, `assemblyai.ts`, `soniox.ts` | os externos em streaming, direto pelo WebSocket, sem SDK. Fonte, data, português em streaming, vocabulário e preço no cabeçalho de cada um |
| `servicos/_externo.ts` | o que os externos têm em comum: conexão, leitura por zod, fechamento com prazo, chave fora de todo erro |
| `servicos/externos.test.ts` | os três contra um servidor WebSocket falso, sem chave: roda no `pnpm verify` |
| `dependencias.ts` | `zod` e `ws`, pegos de `packages/voice-engine` (sem dependência nova na raiz) |
| `decisores/laya.ts` | o Laya: acerto, latência e CPU, sobre o conjunto do filtro. `laya_local.py` só executa os pedidos que recebe (`laya.test.ts`, com o ajudante trocado por um falso) |
| `decisores/jev.ts` | o Jev: os mesmos pedidos do Laya, com acerto e latência (`jev.test.ts`, contra um servidor HTTP falso) |
| `filtro-na-chamada.ts` | a medida da fatia 6 da R12: o filtro **do produto** (`deciders/jev.ts`, as perguntas de `speech-filter.ts`, o prazo de 1 s) sobre o conjunto do filtro, com a leitura por tipo de item, o fundo como marca, p50 e p95 e quantas decisões chegaram a tempo. Teto próprio de US$ 0,05 por rodada (`filtro-na-chamada.test.ts`, com um decisor falso que erra de propósito) |
| `reducao-de-ruido.ts` | a medida da redução de ruído local em 8 kHz (fatias 4 e 4b da DESA-24): só mede, não liga nada |
| `reducao_de_ruido.py` | os candidatos dessa medida (RNNoise, DeepFilterNet em fluxo e em torch; SpeexDSP só se pedido), um por processo |
| `regua-da-reducao.ts` | a régua dela: perda na fala baixa por quadro (acima de 1 dB de média reprova) e na frase inteira, a fala baixa debaixo de ruído, redução do ruído, atraso e tempo por pedaço |
| `barulho-no-provedor.ts` | a medida contra o provedor do ambiente barulhento (fatia 5 da DESA-24): resposta, interrupção falsa e frase longa, com e sem a guarda, o teto por item e a tabela. Testada sem rede em `barulho-no-provedor.test.ts` (sessão falsa e relógio falso) |
| `plano-do-barulho.ts` | o áudio dessa medida: as frases do conjunto na voz `cadu`, misturadas a obra, música e conversa, o ruído e o "uhum" por baixo da fala do agente, e a frase longa |
| `ambiente-barulhento.ts` | só liga essa medida às peças de verdade (os motores de `servicos/openai-hoje.ts` e `gemini-hoje.ts`, o Piper, o relógio do sistema) |

## Montar o ambiente (uma vez, fora do repositório)

Na VPS de teste não há compilador nem `pip`. O caminho que funcionou em 14/11/2026:

```bash
mkdir -p /tmp/bancada-env && cd /tmp/bancada-env
python3 -m venv --without-pip venv
curl -sL https://bootstrap.pypa.io/get-pip.py | ./venv/bin/python
./venv/bin/pip install piper-tts faster-whisper laya
./venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
mkdir vozes && cd vozes
for v in cadu/medium jeff/medium faber/medium edresson/low; do
  n=pt_BR-$(echo $v | tr / -)
  for e in onnx onnx.json; do
    curl -sLO "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/$v/$n.$e"
  done
done
```

## Rodar

```bash
export BANCADA_PIPER=/tmp/bancada-env/venv/bin/piper
export BANCADA_VOZES=/tmp/bancada-env/vozes
export BANCADA_PYTHON=/tmp/bancada-env/venv/bin/python
export HF_HOME=/tmp/bancada-env/hf          # onde os pesos do Whisper e do Laya ficam
# Só com a chave entregue por canal privado (decisão 2 da DESA-19):
# export BANCADA_OPENAI_API_KEY=...  BANCADA_GEMINI_API_KEY=...
# Externos e Jev (R12, fatia 1b), pelo cofre do Paperclip:
# export BANCADA_DEEPGRAM_API_KEY=...  BANCADA_ASSEMBLYAI_API_KEY=...  BANCADA_SONIOX_API_KEY=...
# export JEV_API_KEY=...

pnpm exec tsx scripts/bancada-de-voz/medir.ts --teto-usd 0 --decisor laya
```

Os externos, com o teto da decisão da R12 (US$ 10, somado ao da DESA-10):

```bash
pnpm exec tsx scripts/bancada-de-voz/medir.ts --teto-usd 10 --servicos deepgram,assemblyai,soniox
```

Só o Jev, com o teto dele (US$ 1). Sem nenhum serviço com chave, a bancada nem gera áudio:

```bash
pnpm exec tsx scripts/bancada-de-voz/medir.ts --teto-usd 1 --servicos deepgram,assemblyai,soniox --decisor jev
```

O serviço sem chave sai em "Não medido" como "chave não entregue". No fim, a bancada imprime o
gasto total e o de cada serviço.

Opções: `--servicos whisper-local,openai-hoje`, `--linhas estreita,larga`, `--vocabulario com,sem`,
`--casos nomes,ruido`, `--limite 5` (só as primeiras frases). `--teto-usd` é obrigatório. Antes de
cada frase, a bancada estima o pior caso pelo preço do serviço e para se ele passar do teto. Quem
cobra pela sessão, e não pelo áudio (AssemblyAI; e Soniox, cuja página não diz), declara um pior
caso maior por minuto (`tetoUsdPorMinuto`). O Jev estima um token por byte do pedido antes de cada
pedido. Se o custo real de um pedido (ou de um item) passar do pior caso reservado, o pior caso
deixou de valer: a bancada não abre pedido novo, espera os que estão em voo e diz quanto passou.

`--decisor laya,jev` mede os dois sobre o conjunto do filtro inteiro (o `--limite` e o `--casos`
são das frases da transcrição, e não valem para ele).

## Como cada número é medido

- **Tempo real.** O pedaço `i` de 20 ms sai em `início + (i + 1) · 20 ms`, contra o horário
  absoluto. Depois da fala vão 3 s de silêncio (ou do mesmo ruído), também em tempo real, para o
  serviço fechar o turno sozinho. A bancada **não** avisa ao serviço quando a fala acabou.
- **Início e fim da fala:** marcados na voz sintética limpa (quadros de 10 ms acima de 40 dB abaixo
  do pico), antes de misturar o ruído.
- **Latência até o parcial:** do início da fala ao primeiro texto parcial (ou primeiro aviso de
  texto, nos motores de hoje, que não entregam o texto parcial).
- **Final, nos externos:** Deepgram, cada `Results` com `is_final`; AssemblyAI, o `Turn` de fim
  de turno já formatado (a formatação entra na latência); Soniox, o trecho inteiro no token
  `<end>`, para uma palavra partida em dois tokens não virar duas.
- **Jev e Laya (o filtro):** cada item do conjunto do filtro vira dois pedidos, com o estado
  "Agente: … / Pessoa: …": as três perguntas numa passada, e a pergunta do item sozinha. Com 1 e 3
  chamadas simultâneas (cada chamada faz todos os pedidos). Os três primeiros pedidos aquecem e não
  contam. Latência: do Jev, o pedido HTTP inteiro, da VPS à API; do Laya, o `predict` em CPU.
- **Acerto do filtro:** só a pergunta do item conta. "Fundo" e "terminou" são sim ou não, com 0,5
  de fronteira (na pergunta "fundo", o sim é "é de quem está na ligação"). A leitura acerta quando
  a escolha é o termo esperado, ou "nenhum" quando o trecho não tem termo: o decisor que sempre
  troca perde esses. As opções são os 4 termos do vocabulário mais parecidos com algum pedaço de 1
  a 4 palavras do trecho, em ordem alfabética (na ordem da semelhança, o certo viria primeiro), e
  "nenhum". A saída diz em quantos itens o termo esperado está entre as opções.
- **O fracasso, contado à parte:** quantas falas de quem liga cada modelo marcou como fundo com
  confiança de 0,8 ou mais (o corte do desenho), e quantas leituras trocariam o texto por um termo
  errado com essa confiança.
- **Latência até o final:** do fim da fala ao último trecho final da frase. Sem final em 8 s depois
  do último áudio, a frase conta como "sem final", e o WER dela conta tudo como apagado.
- **Fora do ritmo:** cada item guarda, no resultado bruto, os bytes entregues, a duração do áudio
  entregue, o atraso do envio inteiro (tempo real do envio menos essa duração), o pior pedaço
  contra o seu horário e o pior atraso do relógio da bancada na espera do final. Se qualquer um
  passa de 100 ms (`LIMITE_FORA_DO_RITMO_MS`), o item não foi medido em tempo real: sai das
  latências e do "sem final", conta na coluna "Fora do ritmo" e segue no WER. A tela lista cada
  um. VPS dividida com outro trabalho pesado é a causa mais comum.
- **WER:** soma das edições sobre a soma das palavras do grupo, depois de `normalizacao.ts`.
- **Acerto em nomes:** fração das frases com termo marcado em que **todos** os termos saíram letra
  por letra. "Melgaco" é erro.
- **Ruído:** obra, música e conversa de fundo (três vozes sintéticas que não são a da frase), a
  15, 5 e 0 dB de relação voz/ruído sobre o RMS do trecho da fala. A relação medida sai na tela.
- **Vozes:** quatro vozes do Piper. **Não são sotaques regionais**: a linha "voz" da tabela mede
  erro por voz, e só isso.

## Redução de ruído (fatias 4 e 4b da DESA-24)

Mede, para cada candidato aberto que roda na VPS, o que ele faria **antes** do provedor, em 8 kHz.
Não liga nenhum candidato no produto. Não usa chave.

### Os candidatos (num venv à parte, fora do repositório)

O DeepFilterNet 0.5.6 importa `torchaudio.backend`, que saiu do `torchaudio` 2.2 em diante: ele só
funciona com o `torch` e o `torchaudio` 2.1. Por isso o venv é outro, e não o da bancada. Tudo por
wheel, sem compilador (caminho que funcionou em 15/11/2026):

```bash
cd /tmp/bancada-env
python3 -m venv --without-pip venv-reducao
curl -sL https://bootstrap.pypa.io/get-pip.py | ./venv-reducao/bin/python
./venv-reducao/bin/pip install --only-binary=:all: speexdsp-ns pyrnnoise
./venv-reducao/bin/pip install --only-binary=:all: torch==2.1.2 torchaudio==2.1.2 --index-url https://download.pytorch.org/whl/cpu
./venv-reducao/bin/pip install --only-binary=:all: deepfilternet
```

Os pesos do DeepFilterNet3 baixam na primeira vez para `$XDG_CACHE_HOME/DeepFilterNet`. O candidato
que não carregar sai na tabela como "não instalou", com o motivo.

O DeepFilterNet do pacote em torch só processa o áudio inteiro. Em fluxo, a bancada usa o plugin
LADSPA que o próprio projeto publica em cada versão (o `deep_filter` em Rust, um quadro de 10 ms por
vez). Ele é um `.so` pronto, sem compilar, carregado pelo `ctypes` do Python; o plugin publicado
traz o **DeepFilterNet3 de baixa latência**, e não o DeepFilterNet3 do torch:

```bash
mkdir -p /tmp/bancada-env/df-ladspa && cd /tmp/bancada-env/df-ladspa
gh release download v0.5.6 -R Rikorose/DeepFilterNet -p 'libdeep_filter_ladspa-0.5.6-x86_64-unknown-linux-gnu.so'
sha256sum libdeep_filter_ladspa-0.5.6-x86_64-unknown-linux-gnu.so   # 2ca3205c2911… em 15/11/2026
```

### Rodar

```bash
export BANCADA_PIPER=/tmp/bancada-env/venv/bin/piper
export BANCADA_VOZES=/tmp/bancada-env/vozes
export BANCADA_REDUCAO_PYTHON=/tmp/bancada-env/venv-reducao/bin/python
export XDG_CACHE_HOME=/tmp/bancada-env/cache
export BANCADA_DF_LADSPA=/tmp/bancada-env/df-ladspa/libdeep_filter_ladspa-0.5.6-x86_64-unknown-linux-gnu.so

pnpm exec tsx scripts/bancada-de-voz/reducao-de-ruido.ts
```

Opções: `--candidatos rnnoise,deepfilternet-fluxo,deepfilternet` (o padrão; `speexdsp` ainda roda
se pedido), `--frases 12` (as primeiras do conjunto).

### Como cada número é medido

- **Áudio:** as frases do conjunto na voz `cadu`, com 2,5 s antes e 1,5 s depois, descidas a 8 kHz
  pela linha estreita (`linhas.ts`). O ruído (`ruido.ts` e a conversa de `voz.ts`) desce do mesmo
  jeito e entra pela relação voz/ruído de 15, 5 e 0 dB, sobre o RMS do trecho da fala
  (`misturar`). A relação medida sai na tabela.
- **Conversões:** RNNoise e DeepFilterNet trabalham em 48 kHz. O áudio sobe e desce com o
  `resample` do produto, e a CPU dessas conversões entra na conta do candidato. Um controle "só
  8→48→8 kHz" mostra o que as conversões sozinhas fazem.
- **Atraso somado:** o quadro do candidato (o que ele precisa juntar antes de processar) + o atraso
  da saída, achado pela correlação com a entrada + o que o modelo espera do futuro e não aparece na
  saída (o lookahead do DeepFilterNet) + o lookahead das duas conversões, se elas rodassem em fluxo
  (meia largura do núcleo do `resample`).
- **CPU:** segundos de CPU do processo do candidato (uma linha de cálculo) mais a das conversões no
  Node, sobre os segundos de áudio processados. Carregar o modelo não entra. O DeepFilterNet em
  torch processa o áudio inteiro de uma vez, e a tabela de atraso diz "áudio inteiro" ao lado dele.
- **CPU em fluxo (fatia 4b):** quem roda em fluxo (RNNoise e o plugin do DeepFilterNet) recebe o
  áudio em pedaços de 20 ms, um de cada vez, com o estado guardado entre eles, como a ponte manda.
  Cada pedaço é cronometrado sozinho, em relógio e em CPU do processo inteiro (todas as linhas de
  execução), e a ele se somam as duas conversões de taxa **daquele pedaço**, com o `resample` do
  produto chamado pedaço a pedaço. Sai o tempo por pedaço (média e p99) e a CPU de um núcleo por
  segundo de áudio, somando todos os áudios da rodada. O sinal medido nas outras tabelas usa as
  conversões do áudio inteiro, como na fatia 4. O plugin do DeepFilterNet faz a conta numa linha de
  execução própria e verifica a saída a cada 2 ms: o relógio dele inclui essa espera, e a CPU de
  um pedaço pode cair no pedaço seguinte (a média não muda). Cada áudio roda numa instância nova
  do plugin, num processo filho (a linha de execução dele não para sozinha). Quando uma chamada
  leva mais que o próprio áudio, o plugin avisa e aumenta o atraso no meio do áudio, e o
  alinhamento da régua deixa de valer: esse áudio é refeito (até 4 vezes) e só o que passou sem
  aviso volta para a régua. A tabela de CPU conta os avisos, os áudios refeitos e os que não
  passaram sem aviso, e os pedaços de todas as tentativas entram no tempo.
- **Quanto tira do ruído:** energia que entrou sobre a que saiu (dB) nos trechos só de ruído da
  mistura, antes e depois da fala, sem o primeiro segundo (a adaptação do candidato). Média das
  frases.
- **Perda na fala baixa, medida na frase inteira:** a voz sem ruído, com o pico a −20 dB e a
  −30 dB do fundo de escala. Energia da frase inteira que entrou sobre a que saiu, alinhada pelo
  atraso. Média e pior frase. Na fatia 4, perda acima de 1 dB em qualquer frase reprovava. Ela
  continua na tabela, ao lado da por quadro, mas **não decide mais**: as sílabas fortes escondem
  as fracas, e o filtro que apaga as sílabas fracas passa nela.
- **Perda por quadro (fatia 4b), a régua que decide:** a mesma voz sem ruído, nos dois níveis,
  cortada em quadros de 20 ms. São "quadros com fala" os que ficam a até 30 dB do quadro mais
  forte, na voz limpa. Do quarto mais fraco deles, a perda de cada quadro é a energia que entrou
  sobre a que saiu, e a do áudio é a média dos quadros. Um quadro mudo na saída dá perda infinita
  (a tabela diz a parte dos quadros fracos que calou e a perda média dos outros). **Média das frases acima de 1 dB, em
  qualquer nível, reprova.** O teste prova que ela reprova o filtro que zera os quadros mais de
  12 dB abaixo do mais forte, que passa na régua da frase inteira (`regua-da-reducao.test.ts`).
- **Fala baixa debaixo de ruído (fatia 4b):** os mesmos quadros, com obra, música e conversa por
  baixo da fala baixa a 15, 5 e 0 dB (a relação é sobre a fala baixa). A saída é comparada com a
  **voz limpa**, só nesses quadros, alinhada pelo atraso que a mesma frase teve sem ruído. O ruído
  que sobra na saída **não** conta como voz: o candidato recebe a voz com o ruído e, à parte, a voz
  com o ruído invertido, e a parte da saída que é voz é a média das duas saídas, em que o ruído se
  cancela (separação por inversão de fase, Hagerman e Olofsson, 2004). Por isso a medida debaixo
  de ruído passa cada áudio duas vezes pelo candidato. Sem redução, a perda dá zero. O teste prova
  que ela reprova o filtro que deixa o ruído e corta 6 dB da voz fraca, a 15, 5 e 0 dB. Célula com
  média acima de 1 dB sai em negrito.

## Ambiente barulhento contra o provedor (fatia 5 da DESA-24)

O antes e depois do desenho `docs/specs/2026-11-14-ambiente-barulhento.md` (PR #182), em cada
motor de hoje (OpenAI Realtime e Gemini Live), pelo próprio motor de `packages/voice-engine`: para
`normal` e `noisy` (o `listeningEnvironment` da sessão), com e sem a guarda contra o silêncio
(`apps/voice/src/silence-guard.ts`, com os prazos de hoje, ligada à sessão como `call-session.ts`
liga). Não liga redução de ruído e não muda nenhum prazo nem valor do `noisy`: só mede.

**A rodada paga ainda não aconteceu.** Ela espera o pedido 2 da DESA-24 e a chave de cada motor por
canal privado. Sem a chave, o motor sai como "chave não entregue", sem gerar áudio e sem abrir
sessão, e o gasto é zero.

### Rodar

```bash
export BANCADA_PIPER=/tmp/bancada-env/venv/bin/piper
export BANCADA_VOZES=/tmp/bancada-env/vozes
# Só com a chave entregue por canal privado (nunca a OPENAI_API_KEY ou GEMINI_API_KEY de outro programa):
# export BANCADA_OPENAI_API_KEY=...  BANCADA_GEMINI_API_KEY=...

pnpm exec tsx scripts/bancada-de-voz/ambiente-barulhento.ts --teto-usd 0
```

**A rodada paga vai em duas chamadas** (decisão do Arquiteto na DESA-45). O teto é de US$ 5 no total
e é dividido com a fatia 4 do R3. O pior caso dos dois motores (US$ 5,62, abaixo) não cabe nele.
Por isso o Gemini vai primeiro, sozinho, e o OpenAI vai depois, com o que sobrar:

```bash
# 1. Gemini (pior caso US$ 1,30). TETO_GEMINI = US$ 5 − o gasto real da fatia 4 do R3.
pnpm exec tsx scripts/bancada-de-voz/ambiente-barulhento.ts --motores gemini-hoje --teto-usd "$TETO_GEMINI"
# 2. OpenAI. TETO_OPENAI = US$ 5 − o gasto real do R3 − o gasto real do Gemini (o "Custo real" da 1).
pnpm exec tsx scripts/bancada-de-voz/ambiente-barulhento.ts --motores openai-hoje --teto-usd "$TETO_OPENAI"
```

O que não couber sai como "parou no teto", e a seção diz onde parou. Quem roda não aumenta o teto.

Opções: `--motores openai-hoje,gemini-hoje`, `--frases 1` (quantas frases do conjunto; cada uma
entra em cada ruído e cada nível), `--niveis 15,5,0`, `--partes resposta,interrupcao,longa`.
`--teto-usd` é obrigatório. A saída é uma seção em markdown ("Medida contra o provedor"), com a
data, o modelo e o preço conferido de cada motor, o número de frases, as três tabelas e o custo real.

**Pior caso** (o que a bancada reserva, conferido com o plano gerado em 15/11/2026, sem rede): com
`--frases 1` são 82 itens por motor, US$ 4,32 no OpenAI e US$ 1,30 no Gemini; com `--frases 2`, 118
itens, US$ 6,20 e US$ 1,86. O pior caso conta o áudio inteiro de cada item (a frase com os 20 s de
cauda) ao preço de pior caso do motor, mais 8 s de resposta. O custo real deve ser bem menor,
porque o envio para no primeiro áudio do agente, mas isso não foi medido. Com um teto menor que o
pior caso, a rodada mede até onde couber e diz onde parou: cada item reserva o pior caso dele antes
de abrir a sessão, e a reserva vira o custo do `usage` ao fechar.

### Como cada número é medido

Cada item abre uma sessão nova, com instruções de atendente ("responda numa frase curta"), sem
ferramentas, e a fecha no fim. O áudio vai em pedaços de 20 ms a 8 kHz no ritmo do relógio
(`tempo-real.ts`), como a ponte manda; o motor faz a conversão dele (μ-law no OpenAI). Item cujo
envio atrasou mais de 100 ms contra o horário sai como "fora do ritmo", fora das latências.

1. **Resposta.** 1 s de ruído, a frase, e 20 s de ruído depois, sem parar. O tempo vai do instante
   em que sai o pedaço com a última amostra da fala até o primeiro áudio do agente; o envio para ali.
   Se o agente fala antes do fim da frase, o item é "antecipou" e não entra no tempo. Sem áudio em
   20 s, "sem resposta". A tabela diz, por ambiente, guarda, ruído e nível, a mediana, o p90 e
   quantas vezes a guarda fechou o turno ou pediu para repetir. A mediana e o p90 **não** contam as
   frases em que a guarda pediu para repetir: ali o primeiro áudio é o pedido da guarda, e o tempo
   mediria a guarda, e não o motor. A frase em que a guarda só fechou o turno entra, porque quem
   respondeu foi o motor. "Frases" é o total do grupo, e "Na mediana" é quantas entraram na conta.
2. **Interrupção falsa.** A bancada pede ao agente uma fala de uns 10 s (`say`), manda silêncio até
   ele começar e, daí, 12 s do caso por baixo: obra, música ou conversa no nível em que estariam
   debaixo da voz de quem ligou (15, 5 e 0 dB), ou três "uhum" sintéticos no nível da voz. Conta o
   evento `interrupted` **do motor** que chega enquanto o áudio do agente ainda tocaria na ligação
   (cada pedaço soma a duração dele; a interrupção descarta o resto, como a ponte). O `interrupted`
   com o agente calado não conta: o OpenAI manda um a cada início de fala.
3. **Frase longa.** Frases do conjunto emendadas com pausas de 0,4 s até passar de 12 s, sobre obra,
   música e conversa a 5 dB, só com a guarda. A frase toca inteira, mesmo que o agente fale no meio.
   A tabela diz se a guarda agiu antes do fim da fala, e quando.

Depois do primeiro áudio do agente, a bancada espera até 8 s pelo `usage` da resposta, para o custo
dela entrar na conta, e só então fecha a sessão.

## O que esta bancada não finge medir

- **Redução de ruído: a separação da voz na saída.** A inversão de fase supõe que o candidato
  trata a voz com o ruído e a voz com o ruído invertido do mesmo jeito. As duas misturas têm a mesma
  relação voz/ruído e o mesmo espectro, mas um candidato que decide por quadro pode decidir um
  pouco diferente em cada uma, e a diferença entra na voz medida. Quanto, não foi medido.
- **Redução de ruído: o limiar de "quadro com fala" (30 dB) e o quarto mais fraco.** São escolhas
  da régua, provadas nos testes, e não medidas contra o ouvido de ninguém.
- **Redução de ruído: o DeepFilterNet3 completo em fluxo.** O plugin publicado traz o modelo de
  baixa latência; o DeepFilterNet3 do torch só roda com o áudio inteiro. O custo em fluxo do modelo
  completo não foi medido.
- **Redução de ruído: a ponte de verdade.** Os pedaços vêm de um arquivo, sem rede, sem μ-law e sem
  outras chamadas na mesma VPS. A CPU de várias chamadas ao mesmo tempo não foi medida.
- **Fala atípica.** Voz sintética alterada mediria o efeito, e não a fala. O conjunto não tem esse
  caso. Ele só entra com um banco aberto, com licença para este uso e consentimento declarado dos
  falantes.
- **O filtro sobre transcrição de verdade.** O trecho errado do conjunto do filtro é escrito à
  mão, como uma transcrição erraria. Não sai de nenhum transcritor, e o filtro não roda sobre a
  saída da rodada de transcrição.
- **O filtro sobre o texto parcial, a cada trecho, em paralelo com a fala.** Cada item é um
  pedido isolado, com uma fala do agente. Quantas decisões chegariam a tempo é da fatia 6.
- **Fundo de verdade.** "Fundo" aqui é o texto que a transcrição teria tirado de TV, rádio, anúncio
  ou outra pessoa. Se a transcrição de verdade pega esse texto, e como, não foi medido.
- **Ambiente barulhento contra o provedor: a rodada.** Nenhuma chamada paga saiu ainda. Tudo o que
  esta parte diz do provedor espera a chave, e o que está escrito acima foi provado só com sessão
  falsa e relógio falso.
- **Ambiente barulhento: a ligação de verdade.** Sem telefonia, sem a ponte, sem gravação e sem
  ferramenta. Depois do primeiro áudio do agente a bancada para de mandar áudio, e a ligação de
  verdade continuaria mandando o ruído: o efeito disso na resposta que segue não foi medido. A
  guarda é ligada como `call-session.ts` a liga, mas por código copiado, e não pelo próprio arquivo.
- **Ambiente barulhento: o "uhum".** É o Piper falando "Uhum.", e não a concordância de uma pessoa
  no meio da fala do agente. O nível dele é o da voz, sem medida de quanto um "uhum" real tem.
- **Ambiente barulhento: o custo real e se US$ 5 bastam.** Só o pior caso foi calculado. A voz do
  Piper também pode variar um pouco entre rodadas (o início da fala variou 10 ms entre duas gerações
  da mesma frase), e o ruído não: tem semente fixa.

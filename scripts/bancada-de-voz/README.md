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

## O que esta bancada não finge medir

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

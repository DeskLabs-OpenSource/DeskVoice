# O passo do Rafael: as amostras de voz e a medida do transcritor da OpenAI

Dois comandos, no Mac, com a chave da sua conta. Nada aqui pede a chave a ninguém, e ela não vai
para arquivo, tarefa nem comentário. Decisão do board na DESA-398: D1 = A (amostra estática
versionada) e D2 = B (o transcritor da OpenAI como peça provisória, só se ficar dentro de 700 ms).

Os dois scripts são manuais, fora do CI e da imagem, e não acrescentam dependência ao
`package.json`.

## Antes, uma vez

Na raiz do repositório, com o Node e o pnpm que o projeto usa:

```bash
pnpm install
brew install ffmpeg          # o MP3 das amostras (o script confere o libmp3lame antes de gastar)
```

As chaves entram só nesta janela do terminal, e saem quando ela fecha. Cada script lê **a própria**
variável, e nunca a `OPENAI_API_KEY` de outro programa:

```bash
read -rs AMOSTRAS_OPENAI_API_KEY && export AMOSTRAS_OPENAI_API_KEY
read -rs AMOSTRAS_GEMINI_API_KEY && export AMOSTRAS_GEMINI_API_KEY
```

(o `read -rs` não mostra o que você cola nem o grava no histórico; cole a chave e aperte Enter.)

## (a) Gerar as amostras: no máximo US$ 2

```bash
pnpm exec tsx scripts/amostras-de-voz/gerar.ts --teto-usd 2
```

- Para cada voz de cada motor (30 do Gemini Live e 10 do OpenAI Realtime), nos três idiomas, abre
  uma sessão do próprio motor, o mesmo modelo da ligação, e pede a frase fixa (`FONTES.md`).
- Grava `apps/panel/public/voice-samples/<motor>/<voz>.<idioma>.mp3` e o `manifesto.json` na mesma
  pasta. Para gravar em outro lugar: `--saida <pasta>`.
- **O teto fica dentro do script.** Antes de cada pedido, ele reserva o pior caso daquele pedido
  (US$ 0,22 no OpenAI e US$ 0,04 no Gemini: até 20 s de fala, com folga de tokens). Se o gasto até
  ali mais essa reserva passar de US$ 2, o pedido não sai, nem os seguintes, e a lista do que ficou
  de fora sai no fim. Somadas, as reservas dos 120 pedidos dariam US$ 10,26, mas a reserva vira o
  custo real (o `usage` do provedor) assim que o pedido fecha. A conta que espero é de uns US$ 0,60
  no total, sem medida (veja "Não medido").
- No fim: o gasto total, o de cada provedor, e o trecho de `sample` de cada motor, pronto para a
  fatia 1c colar.
- Provedor sem chave sai como "não gerado: chave não entregue", sem gastar, e o outro segue. Você
  pode gerar um provedor só.
- O arquivo em que o motor falou outra coisa vai como `<voz>.<idioma>.divergente.mp3`, fica marcado
  `divergente` no manifesto e não entra no `sample`. Ouça, se quiser, mas não o mande.

**Repetir uma parte** (o que parou no teto, ou um divergente): `--motores openai-realtime` e
`--vozes marin,cedar`. O manifesto guarda as outras amostras. O teto de US$ 2 é das amostras
inteiras: na segunda rodada, passe `--teto-usd` com **US$ 2 menos o "Gasto total" da primeira**.

## (b) Medir o transcritor da OpenAI na bancada

A bancada da R12 (`scripts/bancada-de-voz/README.md`) mede o transcritor lateral do motor da
OpenAI de hoje (`gpt-4o-mini-transcribe`, dentro da sessão do `gpt-realtime-2.1`), em tempo real,
pela linha estreita (8 kHz, a do telefone).

### Montar o ambiente no Mac (uma vez, fora do repositório)

O README da bancada está escrito para a VPS. No Mac só falta o Piper (a voz sintética que fala as
frases) e as quatro vozes dele. O faster-whisper e o Laya não entram nesta medida.

```bash
mkdir -p ~/bancada-env && cd ~/bancada-env
python3 -m venv venv
./venv/bin/pip install piper-tts
mkdir -p vozes && cd vozes
for v in cadu/medium jeff/medium faber/medium edresson/low; do
  n=pt_BR-$(echo $v | tr / -)
  for e in onnx onnx.json; do
    curl -sLO "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/$v/$n.$e"
  done
done
cd -    # volte para a raiz do repositório
```

### Rodar

A bancada lê `BANCADA_OPENAI_API_KEY`. Use a mesma chave, só nesta janela:

```bash
export BANCADA_PIPER=~/bancada-env/venv/bin/piper
export BANCADA_VOZES=~/bancada-env/vozes
export BANCADA_OPENAI_API_KEY="$AMOSTRAS_OPENAI_API_KEY"

pnpm exec tsx scripts/bancada-de-voz/medir.ts --teto-usd 2.5 --servicos openai-hoje --linhas estreita
```

**A conta do teto.** São 87 casos (24 frases; as 6 de sotaque em quatro vozes; as 5 de ruído em
obra, música e conversa, a 15, 5 e 0 dB), cada um com 0,5 s antes da fala, a fala (uns 3 s) e 3 s
depois: uns 9,7 min de áudio. A bancada mede com e sem vocabulário, e isso dobra: uns 19,5 min. Ao
pior caso da bancada para este serviço, US$ 0,10 por minuto enviado, dá **uns US$ 1,95**. O teto de
US$ 2,50 deixa folga para a fala mais longa que a estimada. Se mesmo assim não couber, a bancada
para antes de passar, e a seção "Não medido" diz onde parou.

### O número que decide

Na tabela, a linha **`openai-hoje` · `estreita` · caso `todos`**, coluna **"Final p50/p95 (ms)"**:
o **p95** precisa ficar **em 700 ms ou menos**. Acima disso, o transcritor da OpenAI não entra
como peça provisória (D2 = B). A tabela traz essa linha duas vezes, com e sem vocabulário: devolva
as duas, e se uma passar e a outra não, a escolha é do Arquiteto. As colunas "Sem final" e "Fora do
ritmo" dizem quantos casos ficaram fora da conta: se "Fora do ritmo" passar de um punhado, o Mac
estava ocupado com outra coisa, e vale rodar de novo.

## (c) O que você devolve, e por onde

Num PR seu contra `main` (o caminho preferido), ou anexado à tarefa da DESA-397:

1. **Os MP3** de `apps/panel/public/voice-samples/<motor>/`, **sem** os `*.divergente.mp3`;
2. o **`manifesto.json`** da mesma pasta;
3. o que a bancada imprimiu: a **tabela agregada**, o gasto e o "Não medido". O texto bruto de cada
   frase fica em `resultados.json`, na pasta temporária que a bancada indica, e não precisa vir.

**Nunca a chave.** Nenhum dos três contém a chave: os dois scripts trocam o valor de toda variável
`*_API_KEY` do ambiente por `***` em tudo o que escrevem. Mesmo assim, antes de mandar, confira:

```bash
for k in "$AMOSTRAS_OPENAI_API_KEY" "$AMOSTRAS_GEMINI_API_KEY"; do
  [ -n "$k" ] && grep -rlF -- "$k" apps/panel/public/voice-samples && echo "PARE: a chave apareceu"
done
```

No fim, feche a janela do terminal (as variáveis somem com ela).

## Testes

`amostras.test.ts` (motor falso) e `motores.test.ts` (os dois motores de verdade contra o provedor
falso de `packages/voice-engine`) rodam no `pnpm verify`, sem rede e sem chave: o teto para antes de
passar, o provedor sem chave sai 0 com "não gerado", a chave não sai em erro, na tela nem no
manifesto, o divergente e o cortado ficam fora do mapa, e o modelo é o padrão do motor.

## Não medido

- **Nenhum pedido pago saiu.** O custo esperado (uns US$ 0,60 nas amostras) é conta minha, e não
  medida: supõe uns 4 s de fala por amostra e o preço de tabela do motor.
- **Tokens de áudio por segundo.** O pior caso supõe 100 por segundo de fala, sem conferir contra a
  fatura. Se o custo real de um pedido passar do pior caso reservado, o script não abre pedido
  novo e diz quanto passou.
- **O que o provedor cobra depois do corte.** Fala de mais de 20 s fecha a sessão; se o provedor
  cobra o que ainda geraria, não sei. Sem `usage` a tempo, o custo conta como o pior caso inteiro.
- **A duração das frases da bancada.** Os 19,5 min saem da média de palavras do conjunto, e não do
  áudio do Piper, que não gerei para esta conta.
- **O ambiente da bancada no Mac.** O `pip install piper-tts` foi provado na VPS (Linux), e não num
  Mac. Nenhum dos dois comandos foi rodado num Mac.
- **Se o motor obedece à frase.** O pedido de fala literal é o da ligação; quantas vozes saem
  `divergente` só a rodada dirá.

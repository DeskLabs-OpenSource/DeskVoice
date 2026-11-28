# Sonda do Meet

A fatia 1 do canal de reuniões (`docs/specs/2026-11-23-canal-de-reunioes.md`, seção 7). Um
Chromium sem tela entra numa reunião do Google Meet pelo link, como convidado **"Nome (IA)"**.
Ele espera o anfitrião admitir, toca 10 s de fala gravada, grava 30 s do que ouve e sai.

Script manual. **Fora do CI e fora do produto**: nada daqui entra na imagem, e nenhuma dependência
nova entra no `package.json`. O Playwright vem do painel (`dependencias.ts`), e a descida para
8 kHz é a mesma da voz (`resample`, `packages/voice-engine`).

## Quando pode rodar

**Uma vez, numa reunião nossa, com o dono como anfitrião** (pedido 3 do desenho, decidido A pelo
Rafael em 26/11/2026). O `robots.txt` do Meet bloqueia o endereço da reunião (seção 2.4 do
desenho). Por isso a sonda só anda com `--anfitriao-presente` e só aceita um link
`https://meet.google.com/abc-defg-hij`. Ela não é para reunião de outra pessoa, nem para rodar de
novo sem outra decisão do dono.

### Os termos do Meet, conferidos de novo em 27/11/2026

| Texto | Endereço | O que diz hoje |
|---|---|---|
| Termos de Serviço do Google | https://policies.google.com/terms | Em vigor desde 30/07/2026, igual à leitura de 24/11: *"using automated means to access content from any of our services in violation of the machine-readable instructions on our web pages (for example, robots.txt files that disallow crawling, training, or other activities)"* e *"bypassing our systems or protective measures"* |
| `robots.txt` do Meet | https://meet.google.com/robots.txt | Igual: `User-agent: *` e `Disallow: /`. Ficam liberados só `/`, `/about`, `/intl/*/about`, `/_meet`, `/_meet/`, `/landing` e `/sitemap.xml` |
| Política de Uso Aceitável do Meet | https://support.google.com/meet/answer/9847091 | Atualizada em 11/09/2025, igual. A parte de spam diz *"unwanted content that is created by an automated program"*. A leitura de 24/11 não tinha citado essa frase |

## O que o anfitrião faz (cerca de 5 minutos)

1. Abre uma reunião do Meet com a conta dele e manda o link a quem vai rodar a sonda.
2. Fica na sala. Quando aparecer o pedido de **"Sonda DeskVoice (IA)"** (ou o nome do `--nome`),
   clica em **Admitir**. A sonda espera até 5 minutos (`--espera-lobby`).
3. Logo depois de entrar, a sonda fala por 10 s: são dois avisos gravados em pt-BR do próprio
   DeskVoice ("indisponível" e "não recebi a sua escolha"). O anfitrião anota se ouviu, e se cortou.
4. Quando a sonda parar de falar, o anfitrião fala por cerca de 20 s (contar de 1 a 20 basta). A
   gravação dura 30 s a partir do começo da fala da sonda, então sobram uns 20 s para ele.
5. A sonda sai sozinha. O anfitrião diz a quem rodou se ouviu os 10 s.

## Como rodar

```sh
pnpm install
pnpm --filter ./apps/panel exec playwright install chromium   # uma vez
pnpm exec tsx scripts/sonda-reuniao/sonda.ts https://meet.google.com/abc-defg-hij --anfitriao-presente
```

Opções: `--nome Lia` (o "(IA)" vem sempre), `--fala a.wav --fala b.wav` (PCM16; completa ou corta
em 10 s), `--espera-lobby 300` (de 10 a 1800 s), `--saida <pasta nova>` e `--com-tela` (navegador
com janela, para ver a página).

Rode no Linux para ter CPU e memória (é o que decide quantas reuniões uma VPS aguenta). No macOS a
sonda mede o resto e diz "não medido" para os dois.

## O que ela mede

O relatório sai na tela e em `relatorio.json`, na pasta de saída. O caminho dela sai na tela e no
campo `outDir`.

| Campo | O que é |
|---|---|
| `admission` | `admitted`, `denied`, `waited_too_long` ou `no_join_button`, e quanto tempo o pedido esperou |
| `steps` | cada passo na página, com o tempo e se deu certo. Se a entrada falhar, sai também `falha.png` |
| `sent` | o nível da fala que a sonda tocou (`enviada.wav`) |
| `heard` | o nível do que ela ouviu, na taxa do navegador (`escuta-original.wav`) e em 8 kHz (`escuta-8k.wav`), com a fração do tempo com som e o som estourado |
| `rtc` | pacotes de áudio enviados e recebidos pelo WebRTC, faixas recebidas e a energia do que saiu pelo microfone trocado |
| `resources` | CPU (% de um núcleo) e memória do Chromium, esperando no lobby e dentro da reunião |

**A sonda não diz "passou".** Os números dizem que havia som, mas não dizem se a fala se entende.
O resultado só vale com as duas respostas humanas que ela imprime no fim: o anfitrião ouviu os
10 s? O anfitrião reconhece a própria fala em `escuta-8k.wav`? Esse é o fracasso nomeado no
desenho: a sonda "passa" sem que um humano tenha ouvido o áudio dos dois lados.

## A pasta de saída

A pasta tem a voz e a imagem de quem estava na reunião. Por isso a sonda cuida dela assim:

- **Ela é sempre nova.** Sem `--saida`, a sonda cria uma pasta de nome aleatório em
  `$TMPDIR/sonda-reuniao-*`. Com `--saida`, ela cria exatamente o caminho pedido, e para antes de
  abrir o navegador se ele já existe (mesmo vazio, mesmo um link). Uma pasta que outra conta
  preparou antes nunca é usada.
- **Ela é só de quem roda:** a pasta fica com 0700 e cada arquivo com 0600, qualquer que seja a
  máscara do processo. Um arquivo que já esteja lá não é sobrescrito.
- Se o `TMPDIR` de quem roda é apagado no fim da sessão, passe `--saida` com um caminho novo fora
  dele, para a pasta durar até ser copiada.

O que fica nela: `enviada.wav`, `escuta-original.wav`, `escuta-8k.wav`, `relatorio.json` e, se a
entrada falhou, `falha.png`.

## A gravação: quem ouve, por onde passa, quem apaga

1. **Quem ouve as duas gravações (`escuta-8k.wav` e `escuta-original.wav`): o anfitrião.** A voz
   gravada é a dele, e só ele responde à segunda pergunta humana (se reconhece a própria fala). Os
   agentes não ouvem áudio.
2. **Por onde passa: a pasta inteira vai de uma vez, da máquina onde a sonda rodou para a máquina
   do anfitrião,** levada pela sessão que entrega o arquivo ao dono, por um caminho direto entre as
   duas máquinas (cópia por ssh). Nada passa por e-mail, chat, tarefa nem repositório.
3. **Quem apaga, e quando:**
   - antes da cópia, quem roda a sonda leva o `relatorio.json` para a pasta do dono. Depois de a
     cópia chegar, apaga **a pasta inteira** na máquina onde rodou;
   - a sessão que entregou a cópia apaga **a pasta inteira** na máquina do anfitrião assim que ele
     responder às duas perguntas.

   Fora essas duas, não fica nenhuma cópia com a voz dele. O áudio e as capturas nunca entram no
   repositório. O que volta para a pasta do dono é o `relatorio.json` (o código da reunião vai
   mascarado: `abc-****-hij`) e as duas respostas humanas.

## Peças

| Arquivo | O que faz |
|---|---|
| `sonda.ts` | as opções, a recusa antes do navegador e a rodada inteira |
| `pasta.ts` | a pasta de saída nova e só de quem roda (0700), e os arquivos com 0600 |
| `meet.ts` | o link aceito, o nome com "(IA)" e os passos na página do Meet (português e inglês) |
| `pagina.ts` | o que entra na página antes de ela carregar: o microfone trocado por uma faixa WebAudio, a mistura das faixas recebidas e os números do WebRTC |
| `audio.ts` | WAV, a descida para 8 kHz e os níveis |
| `processos.ts` | CPU e memória pelo `/proc` |
| `dependencias.ts` | o Playwright do painel |

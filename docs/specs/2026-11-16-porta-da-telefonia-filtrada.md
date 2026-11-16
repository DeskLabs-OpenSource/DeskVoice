# Porta da telefonia filtrada: a central só aceita SIP das linhas cadastradas

- **Estado:** desenho. Nenhum código de produto foi escrito.
- **Data:** 2026-11-16
- **Quem pediu:** o dono, na decisão da issue #274 (opção **A**), roteiro de novembro, item R14.
- **Origem:** a medição de @webtecnica numa instalação real e o PR #267. Crédito em todos os
  commits que reaproveitarem algo do #267 (`Co-authored-by`), no `CREDITS.md` e no fragmento.
- **Base lida:** `origin/main` em `ec353ad`. Os nomes citados foram conferidos nesse commit, salvo
  os marcados como **novo**.

## 1. Problema

O Compose publica `5060/udp` e a faixa de RTP para a internet em toda instalação, e o `ufw` não
filtra porta publicada pelo Docker (`docs/fundacao/ufw-e-docker.md`). O `pjsip.conf.base` declara o
`transport-udp` em `0.0.0.0:5060` e não tem ACL. Uma central sem linha nenhuma respondia a uma
consulta SIP vinda de fora (medido por @webtecnica). Com linha, ela responde a qualquer origem: a
requisição que não casa com linha cai no endpoint artificial e recebe um desafio de autenticação.

O #267 fechava a publicação por `.env`. Não entra: reinstalar fecharia a linha de quem já tem
operadora, e abrir exigiria editar arquivo na VPS (parecer da sessão revisora no #267).

## 2. A decisão de forma: filtrar na central, a partir do que a tela já gera

A porta continua publicada. Quem decide quem fala com a central é o arquivo que o processo de voz
já gera a partir das linhas (`applyTrunks`, em `apps/voice/src/trunks.ts`), e nada mais:

- **Nada no `.env`, nada no Compose, nada no instalador.** Nenhuma variável nova. Reinstalar e
  atualizar não mudam a lista de quem é aceito; só a tela muda.
- **O mecanismo é o ACL do PJSIP** (`type=acl`, módulo `res_pjsip_acl`): `deny` para tudo, depois um
  `permit` por endereço liberado. Ele age antes da identificação da linha, então vale também para
  `OPTIONS` e `REGISTER` de varredura.
- **Endereço liberado de uma linha** (**novo**, calculado só no processo de voz):
  - linha por IP: o `host` e os `match_extra`, como já são lidos por `readInbound`;
  - linha por registro com IP no `host`: esse IP;
  - linha por registro com nome no `host`: os endereços que o nome resolve (A e AAAA, e os alvos
    do SRV `_sip._udp.<nome>` quando houver), mais os `match_extra` dela;
  - linha deixada de fora do arquivo (`skipped`): nenhum endereço. Ela já aparece "Com falha".
  - os `match_extra` da linha por registro ficam fora da regra de endereço compartilhado: essa
    regra existe porque dois `identify` com o mesmo endereço tornam a linha ambígua, e a linha por
    registro é reconhecida pelo `line`, não pelo endereço. No ACL, endereço repetido é um `permit`
    só.
- **`match_extra` passa a valer também na linha por registro**, só para liberar a entrada (o
  `identify` dela continua sendo o `line` do registro). É a resposta à operadora que registra por
  um servidor e entrega a ligação por outro. Hoje `trunkProblem` e `requireIpModeForAddresses`
  recusam isso; a recusa sai. O `outbound_host` continua só da linha por IP.
- **Nome é resolvido de novo**: a cada `applyTrunks` e num relógio de 5 minutos no processo de voz.
  Mudou o conjunto, aplica de novo (recarregar o `res_pjsip` não derruba ligação). Resolução que
  falha **mantém o último conjunto conhecido** daquela linha e marca a linha `warn` com o motivo;
  nunca encolhe para vazio por falha de DNS.
- **A tela mostra o que está liberado.** Cada linha mostra "Aceita ligações de: …", com a hora da
  última mudança do conjunto ("atualizados em", contrato 4) quando o `host` é nome, e o texto "Se as ligações desta operadora pararem de
  chegar, ela pode estar entregando de outro endereço: inclua-o em Endereços extras". O conjunto
  fica gravado na linha (**novo**: `trunks.inbound_allowed text[] not null default '{}'` e
  `trunks.inbound_resolved_at timestamptz`), escrito só pelo processo de voz.

### O que é núcleo, e as regras de produto

- **Núcleo.** Toda instalação com telefonia tem a porta publicada; não é peça opcional.
- **Disparo em massa:** não facilita. Só restringe a entrada.
- **Ação de quem já instalou:** a linha por IP e a linha por registro cuja operadora entrega pelo
  mesmo endereço do registro seguem sem ação. A linha por registro cuja operadora entrega por outro
  endereço **para de receber** até alguém incluir o endereço na tela. Por isso o fragmento da fatia
  2 é `operator_action`, com o `## Requer atenção` dizendo onde ver e o que incluir. Ninguém edita
  arquivo, e ninguém precisa de SSH.

## 3. Contrato

1. `renderTrunksConf` (ou uma função irmã no mesmo arquivo) devolve, além das seções de linha, uma
   seção `[deskvoice-acl]` `type=acl` com `deny=0.0.0.0/0.0.0.0`, `deny=::/0` e um `permit=` por
   endereço liberado, sem repetição, canônico (a mesma forma de `parseTrunkHost`). Sem linha
   emitida, a seção sai só com os `deny`.
2. Endereço que não é IP nem bloco nunca vira `permit` (o ACL não resolve nome). Bloco mais largo
   que o permitido por `isBlockTooWide` não vira `permit`.
3. A resolução de nome é uma dependência injetada (`resolve(name) => Promise<string[]>`), para o
   teste não ir à rede. Prazo de 3 s por nome; estourou, conta como falha (regra do último conjunto).
4. `inbound_allowed` e `inbound_resolved_at` só mudam quando o conjunto muda (mesma regra de
   `setStatus`: `is distinct from`).
5. A tela lê o que está gravado; o painel nunca resolve nome.
6. **O filtro sai do mesmo conjunto que a tela mostra** (fatia 2): o `[deskvoice-acl]` é escrito a
   partir do conjunto calculado por `computeAllowed` (`plan.allowed`), que já aplica a regra do
   último conjunto, e nunca de `allowedAddresses` chamado direto. Do contrário, tela e filtro
   divergem justamente quando o DNS falha. Teste: resolução que falha, o `permit` é igual ao
   `inbound_allowed` gravado.
7. **O último conjunto só vale para as mesmas entradas** (fatia 2, antes de o filtro entrar).
   Quando o painel muda `host`, `auth_mode` ou `match_extra` de uma linha, ele zera
   `inbound_allowed` e `inbound_resolved_at` dela, na mesma gravação (única escrita do painel
   nessas colunas). Assim, trocar o nome A pelo nome B com B sem resolver não deixa o `permit` da
   operadora antiga, e um extra removido sai na hora. O preço, aceito: editar a linha com o DNS
   fora deixa só a parte numérica (IP e extras) até o nome resolver, com a linha em `warn`.

## 4. Critério de aceite

O que uma pessoa consegue fazer quando terminar:

- Cadastrar uma linha na tela e ver de quais endereços a central aceita a ligação dela, sem abrir
  arquivo nenhum.
- Uma origem que não é endereço de linha recebe recusa (medida no Asterisk de verdade, ver 5).
- Uma origem que é endereço de linha passa (não recebe a recusa do ACL).
- Sem linha cadastrada, **nenhuma resposta SIP** (fatia 3; ver o limite em 6).
- Incluir um endereço extra numa linha por registro e ver a ligação daquele endereço passar.
- Atualizar a partir da última versão com uma linha por IP cadastrada e a linha continuar recebendo.

Fracasso mesmo funcionando:

- Quem atualiza perde a linha **sem ver na tela por quê**. A tela tem de mostrar o conjunto liberado
  antes de o filtro entrar (por isso a fatia 1 vem antes da 2).
- Falha de DNS esvazia o conjunto e corta a linha.
- A recusa do ACL atinge a resposta de `REGISTER` ou de `OPTIONS` que a própria central mandou, e a
  linha por registro cai.
- Reinstalar muda quem é aceito.

## 5. As fatias

Cada uma cabe numa revisão de uma sentada. Uma de cada vez.

1. **O conjunto liberado, sem filtrar ainda** (`new_capability`). Migration das duas colunas;
   cálculo do conjunto no processo de voz (resolução injetada, relógio de 5 min, regra do último
   conjunto); `match_extra` aceito na linha por registro (`trunkProblem`,
   `requireIpModeForAddresses`, e o campo na tela); a tela mostra "Aceita ligações de: …" e o texto
   de aviso. Nenhuma mudança no que o Asterisk aceita. Testes: render e cálculo com os formatos de
   linha que a última versão publicada aceita (por IP, por registro com IP, por registro com nome,
   com `match_extra`); DNS que falha mantém o conjunto; `pnpm verify` e `pnpm test:db`.
2. **O filtro** (`operator_action`, crédito a @webtecnica no fragmento e no `CREDITS.md`). A seção
   `[deskvoice-acl]` no arquivo gerado. Uma sonda SIP (**novo**, `scripts/sonda-sip/`, um `OPTIONS`
   por UDP, que diz se veio resposta e qual código) e um teste de tela em `apps/panel/test/e2e/`,
   que já roda no job `install` contra o Asterisk de verdade da imagem fixada, **sem mudar o
   workflow**: sem linha, a sonda recebe a recusa; com uma linha por IP no endereço de onde a sonda
   sai, ela passa; com a linha em outro endereço, recusa. O PR diz o que mediu, com o código de
   resposta visto:
   - **M1.** O que o ACL devolve a quem é recusado (espero `403`, não medido).
   - **M2.** Uma linha com `qualify` para um endereço liberado continua `online` (a resposta ao
     `OPTIONS` que a central mandou não é barrada).
   - **M3.** O endereço de origem visto pelo Asterisk, entrando pela porta publicada, é o do
     remetente (o `identify` por IP já depende disso; medir no runner, dizer o que não é a internet).
3. **Sem linha, sem SIP.** O `transport-udp` sai do `pjsip.conf.base` e passa a ser escrito no
   arquivo gerado, só quando há pelo menos uma linha emitida. **Só começa depois de medir**, no
   Asterisk da imagem fixada, com `module reload res_pjsip.so` pela ARI e sem reiniciar:
   - **M4.** O transporte novo passa a escutar no recarregamento.
   - **M5.** O transporte removido para de escutar no recarregamento (o kit já registra que, com
     `allow_reload=no`, o recarregamento não aplica `bind`: ver `install/_common.sh`).
   - **M6.** Na atualização, o `pjsip.conf.base` novo com o arquivo gerado antigo (sem transporte)
     não derruba a linha de quem tem operadora antes de o processo de voz regravar. Se derrubar,
     a fatia muda de forma ou não entra.
   Se M4, M5 ou M6 falharem, a fatia **para** e volta ao Arquiteto. O aceite "sem linha, nenhuma
   resposta" fica então em "sem linha, recusa a todos" (o `403` da fatia 2), e o Arquiteto leva a
   diferença ao Líder.
4. **A prova da atualização com linha** (pedido ao dono, porque é workflow). Um passo no CI que
   instala a última versão publicada, cadastra uma linha por IP, atualiza para o PR e roda a sonda.
   Os testes da fatia 1 e o e2e da fatia 2 cobrem o formato das linhas antigas e a versão do PR, não
   o caminho real da atualização.

## 6. O que fica de fora, e os limites conhecidos

- **Fechar a publicação** (opção B da #274). A porta continua visível para varredura.
- **A faixa de RTP.** O Asterisk só trata RTP de sessão aberta; não muda aqui.
- **Alarme reativo.** A central recusa e ninguém fica sabendo: a ARI não expõe a recusa do ACL. A
  tela previne (mostra o conjunto e o aviso), mas não acusa "a operadora tentou de outro
  endereço". Fica para uma fatia futura, se houver um sinal medido (log de segurança do Asterisk
  lido por alguém).
- **Operadora que entrega de endereços que mudam sem estar no DNS.** Só os `match_extra` resolvem.
- **DNS em rodízio.** Um nome que devolve um subconjunto diferente a cada consulta muda o conjunto
  e recarrega o `res_pjsip` a cada 5 minutos. Recarregar não derruba ligação; o custo é ruído. A
  fatia 2 mede com um nome real; se recarregar demais, a saída é uma fatia própria, não um ajuste
  escondido no filtro.
- **Sem linha, o `403` até a fatia 3 entrar.** Ainda é resposta SIP, só que sem nada útil a quem
  procura central.

## 7. O que não foi medido neste desenho

- Nada rodou. Não subi Asterisk: a VPS onde o desenho foi escrito não tem acesso ao Docker.
- O código de resposta do ACL (M1), o comportamento do recarregamento do transporte (M4, M5) e a
  ordem da atualização (M6) vêm da leitura do código e da memória do Asterisk 20, não de medida.
- Não conferi se o `andrius/asterisk` fixado traz o `res_pjsip_acl` carregado.
- Não li o `install/update.sh` inteiro para saber em que ordem ele recria o processo de voz e
  recarrega o Asterisk (importa para M6).
- Não sei quantas instalações têm linha por registro cuja operadora entrega de outro endereço.

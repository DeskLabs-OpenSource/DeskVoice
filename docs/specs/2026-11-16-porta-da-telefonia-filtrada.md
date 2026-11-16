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
- **O mecanismo é o ACL de cada endpoint** (as opções `deny` e `permit` da seção `type=endpoint`):
  `deny` para tudo, depois um `permit` por endereço liberado **daquela linha**. Nunca uma lista
  global (`type=acl`): com a lista global, o endereço da operadora de uma organização liberaria
  a entrada na linha de outra organização (requisito da sessão revisora no parecer do #325). O ACL
  do endpoint age depois da identificação da linha: a requisição de um endereço liberado para a
  linha A que se apresenta como a linha B (o `line` dela) é recusada pela B. A requisição que não
  casa com linha nenhuma já é recusada por falta de endpoint (não há endpoint `anonymous`); o que a
  central responde a ela é a medida M1.
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
  fica gravado na linha (`trunks.inbound_allowed` e `trunks.inbound_resolved_at`, da fatia 1),
  escrito só pelo processo de voz. Na fatia 2, o que veio do nome fica guardado à parte
  (**novo**: `trunks.inbound_from_name text[] not null default '{}'`), porque só essa parte
  usa a regra do último conjunto (contrato 7).

### O que é núcleo, e as regras de produto

- **Núcleo.** Toda instalação com telefonia tem a porta publicada; não é peça opcional.
- **Disparo em massa:** não facilita. Só restringe a entrada.
- **Ação de quem já instalou:** a linha por IP e a linha por registro cuja operadora entrega pelo
  mesmo endereço do registro seguem sem ação. A linha por registro cuja operadora entrega por outro
  endereço **para de receber** até alguém incluir o endereço na tela. Por isso o fragmento da fatia
  2 é `operator_action`, com o `## Requer atenção` dizendo onde ver e o que incluir. Ninguém edita
  arquivo, e ninguém precisa de SSH. **Isso fere a restrição do dono** ("quem já tem operadora não
  perde a linha"), como mostrou a sessão revisora no #343. A saída está no contrato 11, pendente
  da escolha do dono.

## 3. Contrato

1. `renderTrunk` escreve, na seção `type=endpoint` de cada linha, `deny=0.0.0.0/0.0.0.0`,
   `deny=::/0` e um `permit=` por endereço liberado **dessa linha**, sem repetição, canônico (a
   mesma forma de `parseTrunkHost`). O arquivo gerado não tem seção `type=acl`. **Teste de
   isolamento** (render e `test:db`): duas organizações, cada uma com uma linha em endereço
   próprio; o endpoint de cada uma só tem o `permit` dos seus endereços, e nenhum endereço de uma
   aparece na outra, também quando as duas usam o mesmo nome de operadora com resoluções
   diferentes no tempo.
2. Endereço que não é IP nem bloco nunca vira `permit` (o ACL não resolve nome). Bloco mais largo
   que o permitido por `isBlockTooWide` não vira `permit`.
3. A resolução de nome é uma dependência injetada (`resolve(name) => Promise<string[]>`), para o
   teste não ir à rede. Prazo de 3 s por nome; estourou, conta como falha (regra do último conjunto).
4. `inbound_allowed` e `inbound_resolved_at` só mudam quando o conjunto muda (mesma regra de
   `setStatus`: `is distinct from`).
5. A tela lê o que está gravado; o painel nunca resolve nome.
6. **O filtro sai do mesmo conjunto que a tela mostra** (fatia 2): o `permit` de cada endpoint é
   escrito a partir do conjunto calculado por `computeAllowed` (`plan.allowed`), que já aplica a regra do
   último conjunto, e nunca de `allowedAddresses` chamado direto. Do contrário, tela e filtro
   divergem justamente quando o DNS falha. Teste: resolução que falha, o `permit` é igual ao
   `inbound_allowed` gravado.
7. **O último conjunto só vale para o que veio do nome** (fatia 2, antes de o filtro entrar;
   requisito da sessão revisora no #325). O processo de voz grava à parte o que o nome resolveu
   (`inbound_from_name`). O conjunto da linha é sempre: o `host` numérico e os `match_extra`
   **atuais** da linha, mais o que veio do nome (o resolvido agora ou, se a resolução falhou,
   `inbound_from_name`). Um extra removido sai do `permit` na aplicação seguinte, com o DNS
   funcionando ou não. O painel zera `inbound_from_name`, `inbound_allowed` e
   `inbound_resolved_at` só quando muda o `host` ou o `auth_mode` da linha, na mesma gravação
   (única escrita do painel nessas colunas); mudar só os extras não zera nada. Assim, trocar o
   nome A pelo nome B com B sem resolver não deixa o `permit` da operadora antiga. A migration
   preenche `inbound_from_name` das linhas por registro com nome a partir de `inbound_allowed`
   menos os `match_extra` dela (conferir que os dois estão na mesma forma canônica; se não
   estiverem, a subtração é feita na forma canônica). Testes: extra removido com o DNS falhando
   sai do `permit`; extra mudado com o DNS falhando mantém a parte do nome; `host` mudado zera.
8. **O filtro não vale com o conjunto vazio de uma linha ativa** (requisito da sessão revisora).
   Linha emitida cujo conjunto, nesta aplicação, é vazio (linha por registro com nome que nunca
   resolveu e sem `inbound_from_name`) sai **sem** `deny` e sem `permit` no endpoint, como é
   hoje, e fica `warn`. **Também sem filtro** (ajuste B da sessão revisora, no `693ae02`): a linha
   por registro com nome e sem nada vindo do nome, **mesmo com extras**. Os extras sozinhos não
   dizem por onde a operadora entrega, e filtrar só com eles cortaria a entrega pelo servidor do
   registro. A linha fica `warn` com o motivo na tela ("a central ainda não sabe de que endereços esta linha
   recebe; o filtro dela fica desligado até o nome resolver"). O `deny` só é escrito com o
   conjunto calculado na mesma aplicação (`plan.allowed`), nunca com a coluna lida sem cálculo.
   Na atualização, o arquivo gerado antigo não tem ACL e continua valendo até a aplicação da
   partida do processo de voz, que é a primeira a calcular o conjunto. Testes: conjunto vazio,
   endpoint sem `deny` e linha `warn`; o nome resolve, o `deny` e o `permit` entram; linha por IP
   nunca tem conjunto vazio.
9. **Teto de endereços por linha** (requisito da sessão revisora). Os `match_extra` já têm teto
   de 16 (`apps/panel/src/server/shapes.ts`). O que vem do nome tem teto de 16, em ordem canônica
   (para a escolha não variar entre consultas iguais); passou disso, ficam os 16 primeiros e a
   linha fica `warn` ("o nome resolve mais de 16 endereços; inclua em Endereços extras os que a
   operadora usa para entregar"). Teto da linha: 33 (`host`, 16 extras, 16 do nome). O processo
   de voz confere o teto antes de escrever; teste com um nome que resolve 20 endereços.
10. **A parte do nome é a união de 24 h** (ajuste A da sessão revisora, no `693ae02`). Um DNS de
   rodízio devolve um pedaço do conjunto a cada consulta; com só a última resposta, o `permit`
   oscilaria e recusaria ligação válida. A parte do nome é a união dos endereços que o nome
   resolveu nas últimas 24 h, com a hora de cada um em `inbound_from_name_seen`. Dentro do teto
   de 16: primeiro os da resposta de agora, depois os vistos mais recentemente. Um endereço só sai
   quando passa 24 h sem aparecer; com o DNS fora, nada vence. O painel zera
   `inbound_from_name_seen` junto com as outras colunas (contrato 7). Limite conhecido: depois de
   uma queda do DNS de mais de 24 h, a primeira resposta boa vence tudo o que é antigo de uma vez,
   e num DNS de rodízio o `permit` encolhe para esse pedaço até as próximas respostas (observação
   do Verificador; aceito, porque o caso é raro e a tela mostra o conjunto).
11. **Quem já tem operadora não perde a linha na atualização.** **Pendente da escolha do dono**
   (pedido de decisão da R14, opção 1 recomendada). A sessão revisora mostrou que, com o filtro
   ligando sozinho na atualização, a linha por registro cuja operadora entrega por outro servidor
   é cortada, e o `operator_action` avisa do corte mas não o evita. **Se a escolha for a opção 1,
   o contrato é este** (não implementar antes da resposta):
   - Coluna nova `trunks.inbound_filter boolean not null default true`, na mesma migration de
     `inbound_from_name` (ainda não mesclada). A migration grava `false` nas linhas por registro
     que já existem; as linhas por IP ficam `true`. A linha por registro criada depois da
     atualização nasce `true` pelo padrão da coluna, porque quem cadastra vê a lista na tela.
   - O endpoint só ganha `deny`/`permit` com `inbound_filter = true` **e** o conjunto do contrato
     8 permitindo. Com `false`, sai como hoje, sem `deny` e sem `permit`.
   - A linha por IP liga na hora e não tem botão: ela já só era reconhecida pelo `host` e pelos
     extras, que são o mesmo conjunto do `permit`, e não perde nada.
   - A linha por registro com `inbound_filter = false` mostra, no bloco "Aceita ligações de", o
     aviso "Filtro desligado nesta linha: a central aceita a ligação dela de qualquer endereço.
     Confira os endereços acima e ligue o filtro", e o botão **Ligar o filtro**. Com o filtro
     ligado, o bloco tem **Desligar o filtro**, a saída de quem descobre que a operadora entrega
     por um endereço que ninguém conhecia. O aviso não muda o estado da linha para `warn`, porque
     a linha funciona; o `warn` continua só para os contratos 8 e 9. Textos nos 3 idiomas.
   - O botão é um `PATCH` da linha que só grava `inbound_filter`, só para linha por registro, só
     da organização de quem pede (a mesma checagem das outras gravações da linha). Trocar o `host`
     ou o modo não mexe em `inbound_filter`.
   - O fragmento diz que nenhuma linha que já existe é cortada: as por IP passam a filtrar sem
     perder nada, e as por registro ficam sem filtro até alguém ligar na tela.
   - Testes: a migration desliga a linha por registro antiga e mantém a por IP ligada; a linha por
     registro criada depois nasce ligada; com o filtro desligado e o conjunto cheio, o endpoint
     sai sem `deny`; o botão de uma organização não muda a linha de outra; o botão recusa a linha
     por IP; o e2e mede `200` na linha por registro desligada e `401` (`Not match Endpoint ACL`)
     depois de ligar.
   - **Medida antes da versão que levar o PR** (condição da sessão revisora, vale em qualquer
     opção): instalar a última versão publicada, cadastrar uma linha por registro (o registrar
     pode ser a sonda, ou um destino que não responde), atualizar para a versão do PR e conferir
     o que o arquivo gerado tem para essa linha (com a opção 1: nada de `deny`) e o que a tela
     diz.

## 4. Critério de aceite

O que uma pessoa consegue fazer quando terminar:

- Cadastrar uma linha na tela e ver de quais endereços a central aceita a ligação dela, sem abrir
  arquivo nenhum.
- Uma origem que não é endereço de linha recebe recusa (medida no Asterisk de verdade, ver 5).
- Uma origem liberada para a linha de uma organização não entra na linha de outra.
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
- Um extra removido continua liberado porque o DNS está fora.
- A atualização corta a linha antes de o processo de voz calcular o conjunto dela.

## 5. As fatias

Cada uma cabe numa revisão de uma sentada. Uma de cada vez.

1. **O conjunto liberado, sem filtrar ainda** (`new_capability`). Migration das duas colunas;
   cálculo do conjunto no processo de voz (resolução injetada, relógio de 5 min, regra do último
   conjunto); `match_extra` aceito na linha por registro (`trunkProblem`,
   `requireIpModeForAddresses`, e o campo na tela); a tela mostra "Aceita ligações de: …" e o texto
   de aviso. Nenhuma mudança no que o Asterisk aceita. Testes: render e cálculo com os formatos de
   linha que a última versão publicada aceita (por IP, por registro com IP, por registro com nome,
   com `match_extra`); DNS que falha mantém o conjunto; `pnpm verify` e `pnpm test:db`.
2. **O filtro** (`operator_action`, crédito a @webtecnica no fragmento e no `CREDITS.md`). O
   `deny` e o `permit` em cada endpoint, com os contratos 6 a 9 (migration de
   `inbound_from_name`, teste de isolamento entre organizações, conjunto vazio sem filtro, teto). Uma sonda SIP (**novo**, `scripts/sonda-sip/`, um `OPTIONS`
   por UDP, que diz se veio resposta e qual código) e um teste de tela em `apps/panel/test/e2e/`,
   que já roda no job `install` contra o Asterisk de verdade da imagem fixada, **sem mudar o
   workflow**: sem linha, a sonda recebe a recusa; com uma linha por IP no endereço de onde a sonda
   sai, ela passa; com a linha em outro endereço, recusa. O PR diz o que mediu, com o código de
   resposta visto:
   - **M1.** O que a central devolve a quem é recusado: à origem que não casa com linha (sem
     endpoint) e à origem que casa com uma linha mas não está no `permit` dela (espero `401` ou
     `403`, não medido). E se o `andrius/asterisk` fixado aplica `deny` e `permit` de endpoint.
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
   resposta" fica então em "sem linha, recusa a todos" (a recusa por falta de endpoint, M1), e o Arquiteto leva a
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
- **Sem linha, a recusa por falta de endpoint até a fatia 3 entrar.** Ainda é resposta SIP, só
  que sem nada útil a quem procura central.
- **Varredura com linha cadastrada ainda recebe resposta.** Sem lista global, a origem que não
  casa com linha é recusada pela falta de endpoint, e não antes da identificação. Ela recebe a
  recusa (M1), não silêncio. Foi o preço de o `permit` ser por linha (isolamento entre
  organizações).

## 7. O que não foi medido neste desenho

- Nada rodou. Não subi Asterisk: a VPS onde o desenho foi escrito não tem acesso ao Docker.
- O código de resposta do ACL (M1), o comportamento do recarregamento do transporte (M4, M5) e a
  ordem da atualização (M6) vêm da leitura do código e da memória do Asterisk 20, não de medida.
- Não conferi no Asterisk fixado que `deny` e `permit` de endpoint são aplicados (é M1), nem em
  que ponto (antes ou depois do desafio de autenticação).
- Não conferi se `match_extra` é gravado na forma canônica (importa para a migration do
  contrato 7).
- Não li o `install/update.sh` inteiro para saber em que ordem ele recria o processo de voz e
  recarrega o Asterisk (importa para M6).
- Não sei quantas instalações têm linha por registro cuja operadora entrega de outro endereço.

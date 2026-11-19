# Follow-up da ligação que caiu sem conclusão

- **Estado:** desenho. A fatia 1 está no #367. Os dois pedidos da seção 7 foram decididos em 18/11
  (DESA-121). A fatia 3 (a religação, sem tela) está no #455, e a fatia 4 (a religação na tela), no PR
  que sai junto com ele.
- **Data:** 2026-11-16
- **Quem pediu:** o dono, no roteiro de novembro (item R2): "Adicionar sistema de follow-up para
  quando a ligação cair sem ser concluída". A decisão dele em 13/11 foi "deixar configurável, quem
  configura escolhe como o follow-up rola".
- **Base medida:** `origin/main` em `a9509bd`. Os nomes de função, tabela, coluna, chave e evento
  citados abaixo foram conferidos nesse commit, salvo os marcados como **novo**.
- **Alinhado com:** o supervisor de regras fixas
  ([`2026-11-13-equipe-de-agentes-e-memoria.md`](2026-11-13-equipe-de-agentes-e-memoria.md), seção
  4.4), que já está na `main` em [`review_call.ts`](../../apps/routines/src/routines/review_call.ts).
  Este desenho **não cria um segundo revisor**: estende aquele.

## 1. Problema

Hoje, quando uma ligação cai, acontece uma de duas coisas:

- **O motor caiu** (`engine_failed`, ou `call_refused` por motor): o supervisor (`reviewCaseOf`,
  caso 1) abre uma pendência "Retornar para +55…" para uma pessoa. Isso já funciona.
- **Quem ligou desligou no meio da conversa** (`end_reason = 'caller_hangup'`): nada acontece. O
  sistema não distingue "desligou depois de se despedir" de "a linha caiu enquanto o agente
  respondia", e por isso não pode fazer nada.

O dono quer que o operador escolha, por agente, o que acontece quando a ligação cai: nada, uma
pendência para uma pessoa, uma mensagem no WhatsApp para quem ligou ou a IA ligar de volta.

Existem três riscos. O primeiro é tratar como queda uma ligação que terminou bem. O segundo é a
religação contornar a política de saída. O terceiro é a religação gerar outra religação, num laço.

## 2. A definição medida de "caiu sem conclusão"

Uma ligação **caiu sem conclusão** quando valem as quatro condições abaixo. A regra é fixa, não usa
modelo e lê só a linha da chamada e o tipo e os campos estáveis dos eventos, como o supervisor já faz.

1. **É uma ligação recebida e atendida.** `calls.direction = 'inbound'` e há `call_answered`. Ligação
   recusada antes de atender (`call_refused`) continua no caso 1 do supervisor, como hoje.
2. **Terminou por um destes motivos** (`calls.end_reason`):
   - (a) `engine_failed` ou `internal_error`: caiu do nosso lado, no meio da conversa;
   - (b) `caller_hangup` **com a vez aberta**: no instante em que a linha caiu, quem ligou já
     esperava resposta além do prazo da guarda do silêncio, ou uma ferramenta estava em curso
     (seção 3.1). O `agent_speaking` é gravado, mas **não** conta como queda (decisão de 16/11,
     depois da 1ª reprovação do #367);
   - (c) `caller_hangup` **depois do "pode repetir?"**: a guarda já pediu para repetir
     (`caller_unanswered` com `action: "asked_to_repeat"`), e quem ligou não falou mais até
     desligar (seção 3.3). "Não falou mais" é um fato da sessão (`callerSpokeAfterAsk`, seção 3.1), e
     não a ausência de transcrição: a última fala antes do desligar costuma não virar
     `transcript_user` (decisão de 17/11, depois da 3ª reprovação do #367). É quem esperou mais tempo, e o `openTurn` dele sai `null`, porque a guarda
     desarma ao pedir (decisão de 17/11, pedida pela revisão do #367).
3. **Ninguém ficou com o próximo passo na própria ligação.** Não há `transfer_started`,
   `voicemail_left`, `follow_up_created`, `human_notified` nem um `tool_result` de `send_whatsapp`
   com `ok: true`.
4. **Quem ligou tem número legível** (`toE164(from_e164)` não nulo). Sem número, não há a quem
   retornar.

O que **não** é queda, e portanto nunca gera follow-up: `end_call` (o agente encerrou),
`transferred`, `script_finished`, `max_duration`, `cost_ceiling`, `no_answer`, `voicemail_left` e
`caller_hangup` com a vez fechada, que é o "obrigado, tchau" seguido do desligar.

**Por que o desfecho (`classify_call_outcome`) não entra na regra.** Ele depende de modelo, vem
desligado de fábrica (`calls.outcome_enabled`), chega depois da revisão e responde `unknown` quando a
conversa não sustenta uma afirmação. Uma regra de produto que muda conforme o desfecho estar ligado
deixaria de ser medível. A vez aberta é um fato da sessão, gravado no instante da queda.

**A ligação simulada** (`channel = 'simulated'`) segue a mesma regra, com uma diferença: nada sai.
A revisão grava na linha do tempo o que teria acontecido numa ligação de verdade (seção 3.3), e não
abre pendência, não manda mensagem e não liga. É o jeito de o operador testar a configuração. A
regra do supervisor para a simulada (#291) continua valendo.

## 3. Contrato

### 3.1 A vez aberta no fim da ligação (fatia 1, `apps/voice/src/call-session.ts`)

Quando o fim é `caller_hangup` (o `transport.onHangup`), a sessão grava no `call_ended` um campo
**novo**, `openTurn`, com um destes valores:

| Valor | Quando | De onde vem |
|---|---|---|
| `agent_speaking` | Havia fala do agente na fila de áudio, ainda não tocada | A mesma fila que hoje é descartada quando quem ligou desliga (o comentário da #109 em `finish`) |
| `caller_waiting` | A última fala de quem ligou ficou sem resposta **além do prazo** da guarda: a guarda já fechou o turno à força (fase `closed`) | O guarda do silêncio (`silenceGuard`, R11 fatia 1). Na fase `listening` (o prazo ainda corre), a vez conta como fechada |
| `tool_running` | Havia ferramenta em curso ou aprovação pendente | `toolsRunning.size > 0`, lido **antes** do `callEnded.abort` |
| `null` | Nada disso: a vez estava fechada | |

Em qualquer outro motivo de fim, o campo não é gravado. O valor é lido no instante do desligar,
antes de `finish` soltar as ferramentas e esvaziar a fila: depois disso, tudo parece fechado.

**Por que `caller_waiting` só depois do prazo** (decisão de 16/11). A guarda arma no **início** da
fala de quem ligou. Sem o prazo, o fim comum ("Posso ajudar em algo mais?" / "Não, obrigado, tchau"
e o desligar antes da resposta) sairia como vez aberta, e o modo `task` abriria pendência para uma
ligação que terminou bem. O prazo é o da própria guarda (`AFTER_WORDS_MS`, 2,5 s depois do último
texto de quem ligou; `WITHOUT_WORDS_MS`, 8 s quando não houve texto), sem constante nova: quando a
fatia 5 da R11 medir e ajustar o prazo, esta regra acompanha. Quem desliga com a guarda já tendo
agido esperou de verdade.

**O `caller_waiting` dura só 4 s** (`AFTER_CLOSE_MS`): ao pedir para repetir, a guarda desarma e a
vez volta a `null`. Quem esperou mais, ouviu o "pode repetir?" e desligou não sai como vez aberta no
`call_ended`. Esse caso é contado pela revisão, a partir dos eventos (condição 2(c) e seção 3.3),
sem mudar a guarda nem o `openTurn`.

**O segundo campo, `callerSpokeAfterAsk`** (decisão de 17/11, depois da 3ª reprovação do #367).
No mesmo fim por `caller_hangup`, e **só** se a guarda pediu para repetir ao menos uma vez nesta
ligação, a sessão grava no `call_ended` o booleano `callerSpokeAfterAsk`: `true` se, depois do
**último** `asked_to_repeat`, chegou ao menos um `callerActivity` com `words: true`; `false` se não.
Sem pedido na ligação, o campo não é gravado.

- A sessão marca o fato no próprio `on("callerActivity")`, **antes** de a guarda filtrar o sinal
  (a guarda ignora fala durante o áudio do agente, e quem diz "tchau" por cima do "pode repetir?"
  falou do mesmo jeito). Vale só o sinal da sessão em curso (`current()`), como hoje.
- O pedido zera o fato no mesmo instante em que o `caller_unanswered{asked_to_repeat}` é emitido.
- `words: false` (início de fala sem texto) **não** conta: com ruído contínuo ele nunca para, e a
  linha ruim é justamente o caso que a 2(c) quer cobrir.
- É um fato fixo, sem texto. A transcrição sozinha não basta: no Gemini Live o texto de quem ligou
  só vira `transcript_user` no `flush`, que não acontece no `close()`; no OpenAI Realtime o
  `completed` chega depois do fim da fala e pode se perder no desligar. As palavras parciais, porém,
  chegam à sessão como `callerActivity{words: true}`.

**Por que `agent_speaking` não conta** (mesma decisão). Quem desliga no meio da fala do agente é,
na maior parte, quem já ouviu o que precisava, inclusive a despedida do agente sem `end_call`. A
regra é fixa e sem modelo, e não tem como separar isso de uma linha que caiu. O valor continua
gravado no `call_ended`, para medir; o caso 5 não o usa. A estimativa é a do tempo de áudio da
guarda (`agentAudio`), e não a fila do transporte: basta para um valor que só é gravado.
O teste que prova isso usa uma sessão de verdade com motor manual (como `follow-up-call.db.test.ts`)
e cobre os quatro valores.

### 3.2 A escolha do operador (fatia 1, migration **nova**)

- `agents.drop_follow_up text not null default 'off' check (drop_follow_up in ('off', 'task',
  'whatsapp', 'call_back'))` (**nova**). O padrão `off` mantém o comportamento de hoje para quem já
  instalou: o caso 1 do supervisor continua abrindo a pendência, e o `caller_hangup` com a vez aberta
  continua sem efeito.
- `agents.drop_follow_up_message text` (**nova**, fatia 2), nula: o texto do WhatsApp para quem
  ligou (seção 3.5).
- A rota `PATCH /api/v1/agents/[id]` aceita os dois campos, validados com zod. A rota recusa
  `whatsapp` ou `call_back` quando o modo está indisponível (seções 3.5 e 3.6), com o código da
  recusa. A mesma conferência roda de novo na hora de agir, porque o pré-requisito pode ter sido
  desligado depois.

### 3.3 A revisão (fatia 1, `apps/routines/src/routines/review_call.ts`)

O supervisor continua sendo a única revisão depois da ligação. Ele ganha:

- **o caso 5, `call_dropped`** (**novo** em `REVIEW_CASES`, frase "a ligação caiu no meio da
  conversa"), que é a condição 2(b) da seção 2 com `openTurn` em `caller_waiting` ou `tool_running`,
  **e também** o `internal_error` da condição 2(a) numa ligação recebida e atendida (com `openTurn`
  nulo no evento), **e também** a condição 2(c), o desligar depois do "pode repetir?" (abaixo). O caso 1 continua **igual a hoje**, sem o `internal_error`: assim o modo `off`
  não muda nada para quem já instalou, e o `internal_error` só age em quem escolheu um modo;
- **a leitura do modo do agente que atendeu** (`calls.agent_id`). Com passagem entre agentes, vale
  o modo de quem atendeu, o mesmo agente cujo dono recebe a pendência hoje. É uma configuração só,
  e não a soma de várias;
- a consulta de eventos passa a ler `call_answered`, `transfer_started` e o `openTurn` de
  `call_ended`, e, para a condição 2(c), a ordem de `caller_unanswered`, `transcript_user` e
  `transcript_agent`.

**A condição 2(c), lida dos eventos** (decisão de 17/11). Vale quando o fim é `caller_hangup` e o
`openTurn` é `null`, o `call_ended` tem `callerSpokeAfterAsk` **igual a `false`** (ausente não vale),
há ao menos um `caller_unanswered` com `action: "asked_to_repeat"` e, depois do **último** deles:
- não há nenhum `transcript_user`;
- há **no máximo um** `transcript_agent`. Esse é o espaço da transcrição do próprio pedido, se o
  motor gravar uma. A regra conta eventos, sem ler texto. Dois ou mais significam que o agente
  respondeu de fato, e então não conta.

A ordem é a da linha do tempo (`at`, e o `id` no empate). O evento `drop_follow_up` desse caminho sai
com `case: "call_dropped"` e `openTurn: "caller_waiting"`: é a leitura da revisão, e o `call_ended`
continua com `null`, que é o que a sessão viu.

O que cada modo faz com os casos 1 e 5:

| Modo | Caso 1 (caiu do nosso lado) | Caso 5 (desligou com a vez aberta) |
|---|---|---|
| `off` (padrão) | Pendência, como hoje | Nada, como hoje |
| `task` | Pendência | Pendência |
| `whatsapp` | Mensagem para quem ligou; pendência só se a mensagem não sair (3.5) | Igual |
| `call_back` | Religação agendada; pendência só se a religação não acontecer (3.6) | Igual |

Os casos 2, 3 e 4 não mudam com o modo. Continua valendo no máximo **uma** pendência do supervisor
por ligação: o índice `follow_ups_one_review_per_call_idx` já garante isso, e a pendência de reserva
dos modos `whatsapp` e `call_back` usa o mesmo `source = 'review_call'`.

**Evento novo, `drop_follow_up`** (**novo** em `CALL_EVENT_KINDS`), gravado na ligação original
sempre que a regra da seção 2 bate e o modo não é `off`. O payload tem só campos fixos:
`{ case: "engine_failed" | "call_dropped", mode, action, simulated, openTurn }`. `action` é uma
destas: `task_opened`, `whatsapp_queued`, `call_back_scheduled`, `skipped` (com `reason`:
`do_not_call`, `mode_unavailable`, `recent_follow_up`, `org_limit`). Na simulada, `simulated: true`, e a ação é a
que teria acontecido. Nenhum texto da conversa entra no evento.

**Um follow-up por número a cada 24 horas.** Antes de mandar mensagem ou agendar religação, a
revisão confere se o mesmo número já recebeu `whatsapp_queued` ou `call_back_scheduled` nas últimas
24 horas, em qualquer ligação da organização. Se recebeu, grava `skipped` com `recent_follow_up` e
cai no caminho da pendência. O motivo é que o número de quem liga pode ser forjado. Sem esse limite,
quem quisesse incomodar alguém ligaria várias vezes com o número da vítima e desligaria no meio da
conversa, e a instalação mandaria mensagens ou ligaria para ela.

**Um teto de mensagens por organização protege o número.** No modo `whatsapp`, a organização manda
no máximo 3 mensagens para quem ligou em 60 minutos corridos e 20 em 24 horas corridas
(`CALLER_MESSAGE_ORG_PER_HOUR` e `CALLER_MESSAGE_ORG_PER_DAY`, constantes, sem ajuste na tela). A
contagem usa as linhas de `notifications` com `audience = 'caller'` da organização criadas na janela,
inclusive as que falharam e as apagadas a pedido do titular (o apagamento anula o `target`, mas a linha
fica). A simulada não conta, porque não cria aviso. Acima do teto, a revisão grava `skipped` com
`org_limit` e abre a pendência de reserva, com o título "Retornar para <número>: a mensagem para quem
ligou passou do teto da organização". Uma trava por organização (`pg_advisory_xact_lock`) segura as
duas contagens, a do número e a da organização, quando duas revisões correm ao mesmo tempo.

**A ordem no modo `whatsapp`:** lista de não ligar, pré-requisito, 24 horas por número, teto da
organização. Número na lista não ganha pendência nem quando falta o pré-requisito. O modo `task` não
muda.

### 3.4 Pendência (fatia 1)

Modo `task`, ou a reserva dos outros modos: `createFollowUp` como o supervisor já faz, com o título
fixo `reviewTitle(caller, case)` e o dono configurado no agente (`agents.follow_up_owner_user_id`).
Nada novo além da frase do caso 5 e das frases da reserva, como "a mensagem para quem ligou não saiu"
e "a religação não aconteceu: <motivo em frase fixa>".

### 3.5 Mensagem no WhatsApp para quem ligou (fatia 2)

**Por que os avisos ao dono têm corpo fixo**
([`follow_up.ts`](../../apps/routines/src/routines/follow_up.ts), linhas 6 a 13): o corpo de um
aviso (`notifications.body`) não sai por prazo nenhum, e o WhatsApp é um canal fora da instalação.
Por isso o título da pendência, que é texto sobre quem ligou, nunca vai no corpo.

A mensagem para quem ligou herda as duas razões e soma uma terceira: **o número pode não ser de
quem ligou**, seja por um número forjado, seja por um fixo sem WhatsApp atendido por outra pessoa.
Por isso:

- **O texto é fixo por agente, escrito pelo operador**, em `agents.drop_follow_up_message`, com no
  máximo 300 caracteres e **sem variável nenhuma**: nem nome, nem horário, nem assunto, nada que
  venha da conversa. Vazio, vale um texto padrão do dicionário, na língua do agente que atendeu, com
  uma única variável posta pelo sistema: o nome da organização (`organizations.name`), para a
  mensagem dizer quem escreve. O nome é do operador, e não de quem ligou. Em pt-BR: "Olá, aqui é
  <organização>. Sua ligação para nós caiu antes de terminarmos. Se ainda precisar, ligue de novo
  neste número." A tela diz, junto do campo, que o texto vai para o número que ligou, que esse
  número pode não ser de quem ligou, que nada da conversa deve entrar nele e que ele deve dizer o
  nome da empresa. Diz também que a mensagem escreve primeiro para um número que pode nunca ter
  falado com o WhatsApp da central, o que pode levar a restrição ou bloqueio do número, e mostra o
  teto da organização (seção 3.3).
- **Só com conector de WhatsApp** (`hasWhatsAppConnector`).
- **Só com `whatsapp.trust_caller_id` ligado** (`TRUST_CALLER_ID_KEY` em `send_whatsapp.ts`). É o
  ajuste em que a organização já aceitou mandar mensagem ao número de quem ligou sem confirmação
  humana. Depois que a ligação caiu, não há a quem pedir confirmação na hora. Sem o ajuste, o modo
  fica indisponível na tela e diz por quê.
- **A lista de não ligar vale para a mensagem.** Número em `do_not_call` não recebe mensagem: a
  pessoa pediu para não ser procurada. O resultado é `skipped` com `do_not_call`, sem pendência.
- **O caminho é o dos avisos:** uma linha em `notifications` (`channel = 'whatsapp'`,
  `target` = o número de quem ligou, `call_id` = a ligação original) e a tarefa
  `deliver_notification`, que já entrega para um `target`. Nenhum caminho novo de envio.
- **Coluna nova `notifications.audience text not null default 'team' check (audience in ('team',
  'caller'))`**. Ela separa o aviso à equipe da mensagem a quem ligou, e diz ao apagamento o que
  alcançar.
- **O apagamento a pedido do titular alcança o número.** Hoje `erasures.ts` (linha 198) troca o
  `body` dos avisos, mas não o `target`. Para `audience = 'caller'`, o apagamento também anula o
  `target`. Sem isso, o número apagado ficaria guardado no aviso. O teste de banco prova isso.
- **Falhou a entrega** (`deliver_notification` marca falha): a rotina de entrega, para
  `audience = 'caller'` com `call_id`, abre a pendência de reserva e grava `drop_follow_up_result`
  (3.7) com `whatsapp_failed`.

### 3.6 A IA liga de volta (fatias 3 e 4)

A religação é **ligação de saída**. Vale a lei inteira de
[`ligacoes-de-saida.md`](../doctrine/ligacoes-de-saida.md), sem exceção. Ela nasce desligada (modo
`off`) e só sai por `startOutboundCall`, que chama `checkOutboundAllowed` na mesma transação que cria
a chamada. Não há um segundo caminho que origine chamada. A cerca `outbound-requires-policy` continua
valendo, e o PR mostra que o caminho novo termina em `startOutboundCall`.

**Disponibilidade.** O modo `call_back` só pode ser escolhido com `outbound_policy.enabled`. Sem a
política ligada, a tela mostra o modo indisponível, com a frase "As ligações de saída estão
desligadas. Ligue-as em Ligações de saída, declarando finalidade e base legal" e o link. Se a
política for desligada depois, a revisão grava `skipped` com `mode_unavailable` e abre a pendência.

**Tabela nova `call_backs`** (fatia 3): `organization_id`, `id`, `origin_call_id` (chave composta para
`calls`), `agent_id`, `to_e164`, `attempt` (1 a N), `due_at`, `status` (`scheduled`, `due`,
`placed`, `refused`, `expired`, `cancelled`), `result_call_id` (nula; chave composta para `calls`),
`refusal_code` (nulo; um `OutboundRefusalCode` ou `originate_failed`), `created_at`. RLS como em
`follow_ups`. O índice único `(organization_id, origin_call_id, attempt)` impede duas tentativas com
o mesmo número de ordem.

**Coluna nova `calls.call_back_of uuid`**, a ligação original (chave composta). A tela da religação
mostra "Retorno da ligação de <hora>" com o link, e a tela da original mostra cada tentativa.

**O caminho, passo a passo:**

1. `review_call` (caso 1 ou 5, modo `call_back`) confere a lista de não ligar e o limite de 24 horas
   por número. Passando nos dois, insere `call_backs` (tentativa 1, `due_at = fim da ligação +
   intervalo`) e enfileira a tarefa **nova** `call_back` com `run_at = due_at`. Por fim, grava
   `drop_follow_up` com `call_back_scheduled`. O relógio é a fila, com `run_at`, como nas outras
   rotinas.
2. A rotina `call_back` (apps/routines), na hora marcada, confere se a linha ainda está `scheduled`
   e se a ligação original não foi apagada. Depois muda o status para `due` e faz `pg_notify` no canal
   **novo** `call_backs`. A rotina não disca, porque quem fala com o Asterisk é o processo de voz.
3. O processo de voz escuta o canal `call_backs` (o mesmo padrão de `approvals.ts`, com `listen`) e,
   ao acordar ou ao subir, reivindica as linhas `due` com `for update skip locked`. Para cada uma,
   chama `startOutboundCall({ organizationId, agentId, toE164, callBackOf })`. A política é conferida
   **ali**, na hora de discar, e não na hora de agendar: o horário, o teto do dia e a lista podem ter
   mudado em 30 minutos.
4. Recusa da política: `status = 'refused'`, `refusal_code` igual ao código. A recusa já fica gravada
   como chamada `refused` com `call_refused`, como hoje. Linha `due` com mais de 1 hora (voz parada):
   `expired`, sem discar.
5. O fim da religação (qualquer fim, **inclusive `no_answer`**, que hoje é gravado em
   `asterisk-transport.ts` sem passar por `finish`) enfileira `review_call` para a religação. Para uma
   ligação de saída com `call_back_of`, a revisão **não aplica a seção 2**, porque religação nunca
   gera religação. Ela só grava o resultado na ligação original (3.7) e decide:
   - **atendida** (`call_answered`): fim. Mesmo que ela caia de novo, não há nova tentativa;
   - **não atendida** e há tentativa sobrando: agenda a próxima, `due_at = agora + intervalo`;
   - **não atendida** na última tentativa, **recusada** (menos `do_not_call`) ou **expirada**: abre
     a pendência de reserva;
   - **recusada por `do_not_call`**: só registra. Quem pediu para não ser ligado também não recebe
     ligação de uma pessoa da equipe.

**O que a religação diz.** A sessão da religação usa o agente de sempre, com uma linha **fixa**
somada às instruções quando `calls.call_back_of` não é nulo: "Esta é uma ligação de retorno: uma
ligação deste número para cá caiu antes de terminar. Apresente-se, diga que está retornando e
pergunte se a pessoa ainda precisa de ajuda." Nada da conversa anterior entra por aqui. A memória
entre chamadas (R13), se estiver ligada, carrega o que já carrega para esse número, pelo caminho
dela. O aviso de gravação é dado como em toda ligação.

**Custo.** A religação é uma ligação comum: tem o teto de custo do agente (`cost_ceiling_cents`),
grava o próprio `cost_cents` e entra na tela de custos pelo agente. O resultado gravado na original
leva `costCents` da religação, e a linha do tempo da original mostra a soma.

**Contra o laço.** São quatro travas, e cada uma tem um teste:

- só ligação **recebida** gera religação, e a religação é de saída;
- o índice único por (ligação original, tentativa);
- o teto de tentativas é fixo no código, no máximo 3;
- uma religação por número a cada 24 horas.

Além delas, continuam valendo as tentativas por pessoa e o teto diário por linha de
`checkOutboundAllowed`, que contam a religação como qualquer ligação de saída.

**Tentativas e intervalo.** Os valores são fixos no código, **1 tentativa, 30 minutos depois do fim**,
por decisão de 18/11. O intervalo nunca fica abaixo de 30 minutos, e a religação nunca é
empurrada para a próxima janela. Uma queda às 19h50, com janela até 20h, é recusada com
`outside_window` e vira pendência. Ligar no dia seguinte para quem não pediu incomoda mais do que
ajuda, e uma pessoa da equipe decide melhor.

**Por que isto não é discador.** A doutrina recusa "discador automático, preditivo ou progressivo"
e "importação de lista". Aqui, cada religação nasce de uma ligação que a pessoa fez para a empresa.
É no máximo uma por ligação e no máximo uma por número por dia, e não aceita lista nem número digitado.
É o "retorno de contato" que a doutrina diz caber nos limites, com uma diferença: a pessoa não pediu
o retorno com palavras. Por isso o modo nasce desligado e exige a política de saída já declarada.
O pedido de decisão 2 (seção 7) pergunta se a doutrina deve dizer isso por escrito.

### 3.7 A linha do tempo (fatias 2 a 4)

Na ligação original, além de `drop_follow_up` (3.3):

- **`drop_follow_up_result`** (**novo** em `CALL_EVENT_KINDS`):
  `{ action: "whatsapp_sent" | "whatsapp_failed" | "call_back_placed" | "call_back_refused" |
  "call_back_expired" | "call_back_answered" | "call_back_not_answered", attempt?, callId?,
  refusalCode?, costCents? }`.

Cada tipo tem frase na tela da ligação, nas três línguas, com link para a religação quando houver
`callId`. Na religação, o cabeçalho mostra "Retorno da ligação de <hora>".

### 3.8 Tela (fatias 1, 2 e 4, `apps/panel/src/app/(app)/agents/[id]/page.tsx`)

Bloco **"Quando a ligação cai"** na tela do agente, perto de "Dono das pendências":

- Quatro opções, nesta ordem: "Não fazer nada" (padrão), "Abrir uma pendência para alguém
  retornar", "Mandar uma mensagem no WhatsApp para quem ligou" e "Ligar de volta".
- Abaixo das opções, a definição em uma frase: "Conta como queda quando o sistema falha, quando quem
  ligou fica alguns segundos sem resposta e desliga, quando ouve o agente pedir para repetir e
  desliga sem voltar a falar, ou quando a linha cai durante uma ação do agente. Quem desliga depois
  de se despedir, ou enquanto o agente fala, não conta." (frase da fatia 2, que passa a citar o caso
  2(c); pedido da DESA-86)
- Opção indisponível aparece desabilitada, com o motivo e o caminho para resolver: sem conector de
  WhatsApp; WhatsApp sem confiar no número de quem liga; ligações de saída desligadas.
- A opção "Ligar de volta" diz quantas tentativas e quando ("1 tentativa, 30 minutos depois, dentro
  do horário das ligações de saída"), e que a lista de não ligar sempre vale.
- Na fatia 1 só as duas primeiras opções aparecem. A 2 acrescenta o WhatsApp, e a 4, o "Ligar de
  volta". Nenhuma opção aparece antes do caminho dela existir.
- Textos em dicionário (pt-BR, en, es), no tom do projeto.

## 4. Fatias

Cada fatia cabe numa revisão de uma sentada e tem o próprio fragmento em `.changes/`.

1. **A definição e a pendência.** `openTurn` no `call_ended` (3.1); migration com
   `agents.drop_follow_up`; caso 5 e leitura do modo no `review_call`, com os modos `off` e `task`;
   evento `drop_follow_up` com a simulada; bloco da tela com duas opções; dicionários; testes.
2. **A mensagem no WhatsApp.** `agents.drop_follow_up_message`, `notifications.audience`, envio pela
   fila de avisos, lista de não ligar, limite de 24 horas, `trust_caller_id`, apagamento do `target`,
   reserva em pendência, `drop_follow_up_result` e a opção na tela.
3. **A religação, sem tela.** Tabela `call_backs`, `calls.call_back_of`, rotina `call_back`, escuta
   no processo de voz, `startOutboundCall` com `callBackOf`, `no_answer` enfileirando `review_call`,
   resultado e reserva, linha fixa nas instruções e as quatro travas contra o laço, com teste. O
   caminho só é alcançável pelo banco nesta fatia, e o PR diz isso.
4. **A religação na tela.** A opção "Ligar de volta", com a indisponibilidade, as frases de
   `drop_follow_up_result`, o cabeçalho "Retorno da ligação de…" e o custo da religação na original.

As fatias 3 e 4 tocam a origem de chamada, que é caminho sensível: passam pelo dono antes do merge.

## 5. Critério de aceite

**O que uma pessoa consegue fazer quando terminar.** O operador abre o agente, escolhe "Quando a
ligação cai" entre as quatro opções, faz uma ligação simulada e fecha a aba enquanto o agente executa uma ação (por exemplo, consulta a
agenda).
A linha do tempo da simulada diz o que teria acontecido no modo escolhido. Numa ligação de verdade
que cai, acontece o que o modo diz, e cada passo aparece na linha do tempo da ligação original.

Por fatia, com teste:

- **F1.** Os quatro valores de `openTurn` numa sessão real com motor manual. O `caller_hangup` com a
  vez fechada **não** gera nada em nenhum modo (este é o teste do "follow-up para ligação que terminou
  bem"). O `end_call`, o `transferred` e o `voicemail_left` também não geram. No modo `off`, o
  comportamento do caso 1 fica idêntico ao de hoje (os testes atuais do `review_call` passam sem
  mudança). No modo `task`, o caso 5 abre exatamente uma pendência, e repetir a tarefa não abre a
  segunda. A simulada grava `drop_follow_up` com `simulated: true` e não abre pendência.
  Depois da 1ª reprovação do #367: quem ligou fala e desliga **antes** do prazo da guarda sai com a
  vez fechada (o "tchau"); depois do prazo, `caller_waiting` e o caso 5. O `agent_speaking` é
  gravado e não abre nada em nenhum modo. O `internal_error` numa recebida e atendida abre o caso 5
  em `task` e nada em `off`.
  Depois da revisão de 17/11 do #367: quem ligou fala, espera o "pode repetir?" e desliga sem falar
  de novo abre o caso 5 em `task` (sessão real com motor manual), também depois de uma espera longa
  (por exemplo, 20 s). Se quem ligou fala depois do pedido, ou se o agente responde de fato depois
  dele (dois `transcript_agent`), não abre nada.
  Depois da 3ª reprovação do #367: quem ligou emite `callerActivity{words: true}` depois do pedido,
  **sem** `transcript_user`, e desliga logo: não abre nada em nenhum modo (sessão real com motor
  manual). O mesmo vale com a fala por cima do áudio do pedido. Só `callerActivity{words: false}`
  depois do pedido continua abrindo o caso 5 em `task`. O `call_ended` sem pedido não tem o campo.
- **F2.** Número em `do_not_call` não recebe mensagem. A segunda queda do mesmo número em menos de 24
  horas cai em pendência. Sem `trust_caller_id`, a rota recusa o modo e a revisão grava
  `mode_unavailable`. O corpo da mensagem é exatamente o texto configurado, sem nada da conversa: o
  teste põe um nome na transcrição e confere que ele não está no aviso. O apagamento a pedido do
  titular anula o `target`. A entrega que falha abre a pendência.
- **F3.** A religação só sai por `startOutboundCall`. Com a política desligada, fora da janela, no teto
  diário ou com as tentativas por pessoa esgotadas, a religação é recusada com o código próprio e
  vira pendência. Número em `do_not_call` **nunca** recebe religação: o teste coloca o número na
  lista entre o agendamento e a hora de discar. Religação atendida que cai de novo não gera nova
  religação. O teto de tentativas é respeitado. Duas rotinas `call_back` ao mesmo tempo discam uma
  vez só. A religação tem o teto de custo do agente.
- **F4.** Com a política de saída desligada, a opção aparece desabilitada e diz por quê (e2e). A
  linha do tempo da original mostra o agendamento, a tentativa, o resultado e o custo, com link.
- **Todas.** `pnpm verify` e `pnpm test:db` verdes. A lista "O que o CI não vê" do `AGENTS.md` foi
  respondida no PR.

**O que seria fracasso mesmo funcionando:**

- religação que não passa por `checkOutboundAllowed`, ou que é conferida só na hora de agendar;
- follow-up para ligação que terminou bem (o "obrigado, tchau" seguido do desligar);
- laço de religações, ou mais de uma religação por número por dia;
- mensagem para quem ligou com qualquer texto da conversa, ou que sobrevive ao apagamento;
- quem já instalou ver comportamento diferente sem ter mudado o modo do agente;
- uma opção na tela que não funciona, ou que funciona sem dizer por que está indisponível.

## 6. Fora do escopo

- Empurrar a religação para a próxima janela de horário, ou para o dia seguinte.
- Tentativas e intervalo configuráveis pela tela (seção 7, pedido 1).
- Texto da mensagem com variáveis (nome, horário, assunto).
- Religação a partir de ligação feita pelo WhatsApp (`channel = 'whatsapp'`). Na v1, a religação é só
  para `channel = 'phone'`. A mensagem vale para os dois canais.
- Usar o desfecho ou a análise da ligação para decidir se ela caiu.
- Religação para ligação de saída que caiu.
- Revisão por modelo, que continua sendo pedido de decisão do desenho da equipe de agentes.

## 7. Pedido de decisão

Dono do pedido: **Arquiteto**. Vai ao lote do Líder, no formato do `GOVERNANCE.md`.

Decidido em 18/11 (DESA-121): pedido 1 = A; pedido 2 = A.

1. **Tentativas e intervalo da religação.** Opções: (A) fixos no código, 1 tentativa, 30 minutos
   depois; (B) fixos, até 2 tentativas com 30 minutos entre elas; (C) configuráveis na tela, de 1 a
   3, com intervalo mínimo de 30 minutos. **Padrão sem resposta: A**, que vale quando a fatia 3
   começar.
2. **A doutrina diz por escrito que a religação de ligação caída cabe nos limites?** Opções: (A) uma
   linha nova em `ligacoes-de-saida.md`, em "O que não entra", distinguindo a religação de uma
   ligação recebida, uma por ligação e por número por dia, do discador; (B) não mudar a doutrina, e a
   seção 3.6 deste desenho registra a leitura. **Padrão sem resposta: B.** A doutrina é do dono, e
   este desenho não a muda.

## 8. Não medido

- **Se o `openTurn` distingue bem a queda do "tchau".** O critério é medível, mas não foi medido em
  ligação real. Com a decisão de 16/11, quem desliga logo depois do próprio "tchau" (antes do prazo da guarda)
  ou no meio da fala do agente não conta. O preço é o inverso: a linha que cai enquanto o agente
  fala, ou nos primeiros segundos depois da pergunta de quem ligou, também não conta. Não foi
  medido com que frequência cada um acontece. Uma linha que cai em silêncio, depois da resposta e antes de a pessoa falar, não conta.
  Com a decisão de 17/11, quem desliga depois do "pode repetir?" sem falar de novo conta, por mais
  que tenha esperado. O preço é o caso raro de quem disse "tchau", ficou calado na linha mais de
  6,5 s sem resposta do agente, ouviu o pedido e desligou. Não foi medido se o "pode repetir?" gera
  um `transcript_agent`: a regra aceita zero ou um.
  Não foi medido em ligação real se cada motor entrega `callerActivity{words: true}` para a fala
  curta antes de quem ligou desligar. Onde não entregar, o "tchau" depois do pedido ainda abre
  pendência; a fatia 5 da R11 mede isso com os mesmos eventos.
  A medida vem da fatia 1 em uso: quantos casos 5 por dia, e quantos a equipe fecha como "não era
  queda".
- Se o `silenceGuard` expõe hoje, sem mudança, o estado "vez de quem ligou aberta". O desenho supõe
  que sim, pela R11 fatia 1, mas não leu a função linha a linha. Se não expuser, a fatia 1 acrescenta
  o acessor.
- O comportamento do Asterisk e da operadora numa religação para um número que acabou de desligar
  (ocupado, caixa postal). Não foi conferido. A caixa postal atendida conta como `call_answered`, e
  a religação termina ali.
- Se o WAHA entrega mensagem para número que nunca falou com a conta, e se isso arrisca a conta do
  dono. Não foi conferido nem com a documentação do WAHA nem com a do WhatsApp.
- A regulamentação de telemarketing: vale o que a decisão 0004 já diz. O projeto não leu os textos
  oficiais.
- O tempo entre a queda e o `review_call` rodar. Supõe-se que seja de segundos, pela fila, e isso
  não foi medido.

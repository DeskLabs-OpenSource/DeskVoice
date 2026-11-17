---
name: deskvoice-sistema-vivo
description: 'Aplicar a doutrina do sistema vivo (docs/doctrine/sistema-vivo.md) a uma peça nova ou alterada do DeskVoice: ferramenta, motor de voz, rotina, rota, tela, tabela ou tipo de evento. Percorre as perguntas da lei em ordem e diz onde conferir cada resposta no código, para preencher a lista do PR com o artefato concreto. Use quando a pessoa disser "vou criar uma peça nova", "essa peça está viva?", "o que falta para o merge pela doutrina?", "como preencho a lista do sistema vivo no PR?", "isto é uma ilha?", ou ao revisar um PR que acrescenta peça. Aponta para a lei e não a substitui.'
---

# Aplicar o sistema vivo a uma peça

A lei é [`docs/doctrine/sistema-vivo.md`](../../../docs/doctrine/sistema-vivo.md), e continua sendo.
Esta skill não repete o texto dela: é o procedimento para responder às perguntas da lei com o código
aberto. Se esta skill e a lei discordarem, vale a lei, e esta skill está errada.

## Passo 0: leia a lei

Leia a lei inteira antes de começar, de `origin/main`:

```bash
git fetch origin && git show origin/main:docs/doctrine/sistema-vivo.md
```

Ela tem o princípio-raiz, os sete invariantes (cada um com a pergunta que a peça responde) e "A
lista do PR". Os passos abaixo seguem a ordem dos invariantes.

## Passo 1: ache os vizinhos antes de escrever

Metade das ilhas nasce de não saber o que já existe. Antes de criar, descubra onde a peça mora e
quem está em volta:

- Onde cada tipo de peça mora (ferramenta, motor, rotina, dicionário): skill `deskvoice-doutrina`,
  seção 2.
- Quem já faz algo parecido: `git grep -n "<palavra do domínio>" -- apps packages`.
- Ferramenta nova tem skill própria (`deskvoice-ferramenta`); motor de voz também
  (`deskvoice-motor-de-voz`). Rode as duas coisas: aquela diz como escrever, esta diz se ficou viva.

## Passo 2: as perguntas, em ordem, e onde conferir cada resposta

Para cada invariante, a resposta válida **nomeia o artefato**: o arquivo, a função, o tipo de
evento, a rota, a tela. "Vai aparecer no painel" não é resposta; "grava `engine_failed`, com frase
em `apps/panel/src/i18n/pt-BR/timeline.ts`, e aparece na linha do tempo da chamada" é.

| Invariante da lei | Onde conferir no código | Prova que vale |
|---|---|---|
| 1. Tudo tem um porquê | a issue ou o desenho em `docs/specs/`; mudança de arquitetura em `docs/decisions/` | o número da issue ou o caminho do desenho, na descrição do PR |
| 2. Duas conexões | **entrada**: quem chama (a tela em `apps/panel/src/app/(app)/` que lê a rota; a lista `tools` do agente, para ferramenta; o `kind` passado a `enqueueTask`, para rotina). **Saída**: o que ela alimenta (`recordEvent`, `enqueueTask`, uma tabela que uma tela lê) | `git grep -n "<nome da peça>"` mostrando um chamador e um consumidor fora do próprio arquivo e fora de teste |
| 3. Tudo tem log, e o log tem tela | `recordEvent` (`packages/core/src/events.ts`); o tipo em `CALL_EVENT_KINDS` (`packages/core/src/types.ts`); a frase no dicionário `apps/panel/src/i18n/pt-BR/timeline.ts`; quem desenha a linha do tempo, `apps/panel/src/ui/timeline.tsx`. Fora de uma chamada: `recordOrgEvent` e `ORG_EVENT_KINDS` | o tipo do evento e o arquivo do dicionário onde ele tem frase. Cobram: cercas `call-events-have-one-writer`, `call-end-reasons-have-a-sentence`, `ui-text-lives-in-dictionaries` |
| 4. Continuidade nas duas direções | IA → humano: as ferramentas `transfer_to_human`, `notify_human` e `request_approval` (`packages/tools/src/tools/`), a tela Aprovações (`/approvals`). Humano → IA: `approval_decided`; quando ninguém responde, a rotina `expire_approval` e o `default_on_timeout` do pedido | o que quem recebe lê (o campo e a tela), e o que volta para o agente dizer |
| 5. Nada termina em silêncio | o caminho de falha da peça: a fala para quem está na linha e o evento (`engine_failed`, `call_refused` com `reason`, `tool_result` com `ok` falso) | um teste que força a falha e confere o evento gravado; o código do motivo com frase no dicionário |
| 6. A ligação termina, o trabalho não | `enqueueTask` (`packages/core/src/queue.ts`); a rotina em `apps/routines/src/routines/<kind>.ts`; `task_queued` e `task_finished` na linha do tempo; nova tentativa por `failTask` | a rotina que cumpre o combinado e o evento de desfecho dela. Cobra: cerca `queue-consumers-listen` |
| 7. Autonomia com limite visível | os limites do agente (duração máxima, teto de custo, ferramentas ligadas) na tela do agente (`/agents/<id>`); a política de saída na tela Ligações de saída (`/outbound`), aplicada por `checkOutboundAllowed`; o resto em Configurações (`/settings`) | o campo e a tela onde o dono ajusta. Cobram: cercas `outbound-requires-policy` e `env-vars-have-defaults` |

Quando uma pergunta não se aplica, diga por quê, numa frase. Peça só de leitura, por exemplo, não
deixa trabalho depois da chamada.

## Passo 3: preencha a lista do PR

Copie "A lista do PR" **da lei** (não desta skill) para a descrição do PR, e responda cada item com o
artefato do Passo 2. Item que não se aplica leva "não se aplica" e o motivo: em branco, não.

## Passo 4: quando a resposta não fecha

- **Não acha a entrada ou a saída** (invariante 2): a peça ainda não tem lugar. Antes de criar
  estrutura, procure o consumidor natural, que quase sempre já existe. A lei diz isso em "O que
  esta doutrina não é".
- **O evento não tem tela** (invariante 3): log só no banco é log morto. Ligue à linha do tempo, que
  já lê `call_events`, antes de inventar uma tela.
- **Não há limite configurável** (invariante 7) para uma capacidade que gasta ou age para fora: a
  lei diz que ela não entra. Pare e escreva um pedido de decisão no formato do
  [`GOVERNANCE.md`](../../../GOVERNANCE.md).

## Conferir

```bash
pnpm fences     # as cercas que cobram parte destas respostas
pnpm verify     # lint, tipos, cercas e testes
```

O que nenhuma cerca vê (o porquê, a passagem de bastão, a fala da falha) fica com a revisão, e está
na lista "O que o CI não vê" do [`AGENTS.md`](../../../AGENTS.md).

# 0014: Os direitos de quem ligou se exercem pela tela

- **Estado:** aceita
- **Data:** 2026-11-12
- **Quem decidiu:** o dono do projeto, em 12/11/2026 (pedido de decisão sobre os PRs #64 e #66; resposta: seguir a recomendação, opção A)

## Contexto

A instalação guardava a transcrição de quem ligou para sempre, sem prazo, e não tinha como entregar à pessoa o que guarda sobre ela (item 9.8 da auditoria de conformidade). O contribuidor @webtecnica propôs os dois caminhos como comandos de servidor: o expurgo de transcrição mais antiga que N dias (PR #64) e a exportação da ficha de um telefone em NDJSON (PR #66). As consultas eram boas; o problema era o lugar.

Um comando de servidor contraria a regra 4 do [`GOVERNANCE.md`](../../GOVERNANCE.md): o operador não precisa de SSH. E quem atende o pedido do titular costuma ser a empresa cliente, que usa o painel, e não quem tem a VPS. Os pareceres dos dois PRs apontaram ainda o que o comando não resolvia: sem `--organizacao`, o expurgo e a exportação atravessavam organizações; o expurgo não tinha piso nem deixava registro, e o `cron` sugerido apagava sem rastro; a exportação não registrava quem tirou o dado de quem.

## Decisão

Os dois direitos se exercem pela tela, em Configurações, por organização, só por dono ou administrador, e cada ato fica registrado.

1. **Prazo de guarda da transcrição.** Vazio guarda para sempre, que é o comportamento de antes: quem já instalou não é surpreendido. Preenchido, é um número de dias entre 30 e 3650. A rotina `purge_transcripts` troca o texto das falas (`transcript_user`, `transcript_agent`) mais antigas que o prazo pelo marcador `{ "purged": true }`, pelo ponto de escrita de `packages/core` (`purgeTranscripts`), e grava `transcripts_purged` com a contagem. Ela roda logo que o prazo é gravado e se reagenda uma vez por dia pela fila (`run_at`), sem timer nem polling; sem prazo, a corrente para. Gravar um prazo que apaga pede confirmação na tela, dizendo que o que sai não volta e que os backups já feitos continuam com o texto.
2. **Exportação dos dados de um telefone.** O telefone é normalizado com `toE164` e a consulta corre dentro de `withOrg`: a ficha só traz o que a organização de quem pede guarda. Sai um arquivo NDJSON baixado pelo navegador, com as chamadas, os eventos delas (a fala expurgada aparece com o marcador) e a entrada na lista de não ligar. O telefone vai no corpo do pedido, nunca no endereço, para não parar no log do servidor.
3. **Registro.** Não havia lugar para evento que não pertence a uma chamada (`call_events.call_id` é obrigatório). Nasceu `organization_events`, com vocabulário fechado em `packages/core` (`transcript_retention_changed`, `transcripts_purged`, `caller_data_exported`), quem fez e quando. É só de acréscimo pela permissão do banco: os papéis de aplicação e de sistema leem e inserem, e não alteram nem apagam. A tela mostra os 50 mais recentes.

A consulta de exportação e a ideia do marcador vêm do trabalho de @webtecnica nos PRs #64 e #66, com crédito nos commits.

## Alternativas

| Alternativa | O que é | Por que não |
|---|---|---|
| B. Comando de servidor, como nos PRs #64 e #66, com os defeitos corrigidos | Organização obrigatória, piso, registro em arquivo | Continua exigindo SSH de quem atende o pedido, e quem atende costuma não ter acesso à VPS |
| C. Não fazer | A transcrição fica para sempre e o pedido se atende à mão | Mantém aberto o item 9.8, e o pedido à mão é onde o dado de uma empresa vaza para outra |
| Prazo único da instalação | Um prazo no instalador, para todas as organizações | Quem responde pelo dado é cada empresa; um prazo só decidiria por todas |
| Rotina com timer próprio | Um `setInterval` diário em `apps/routines` | Fila por notificação é regra da casa; a tarefa com `run_at` já é o relógio, e sobrevive a reinício |

## Consequências

- O resumo da chamada e os argumentos das ferramentas (o texto de uma mensagem enviada por WhatsApp, por exemplo) não saem com o prazo. O guia de conformidade diz isso com essas palavras.
- Os backups já feitos continuam com o texto até serem descartados. A tela e o guia dizem.
- O registro de exportação guarda o telefone exportado, em texto, no banco da organização: é o que permite dizer depois quem tirou o dado de quem. Ele não sai com o prazo da transcrição.
- A busca da exportação é pelo número. Quem ligou de outro telefone precisa de uma exportação por número.

### Emenda de 2026-11-14: o resumo entra no prazo

O item das consequências que diz que o resumo da chamada não sai com o prazo deixou de valer. O texto
acima fica como registro do que foi decidido em 12/11. O gatilho desta revisão foi a
[issue #138](https://github.com/DeskLabs-OpenSource/DeskVoice/issues/138), aberta na revisão dos PRs
#133 e #134: o resumo guarda as falas de quem ligou em linhas "Cliente: …" e, vencido o prazo, a
transcrição sumia e o resumo continuava com parte do que a pessoa disse.

O que vale agora:

- **O resumo sai com a transcrição da mesma chamada.** `purgeTranscripts` troca `calls.summary` pelo
  marcador `PURGED_SUMMARY_TEXT` nas chamadas começadas antes do limite, que é o mesmo critério de data
  das outras cópias da conversa na linha da chamada (`outcome_evidence`, `analysis`). A linha da
  chamada fica: sai o texto, não o registro de que houve chamada.
- **A contagem do evento soma os dois.** O `count` de `transcripts_purged` conta as falas e os resumos
  trocados na passagem. O resumo já trocado não é reescrito nem recontado, e o resumo de uma chamada
  apagada a pedido do titular não é tocado: ele já tem o marcador do apagamento.
- **A tela diz o que aconteceu.** A tela da chamada mostra, no lugar do resumo, que ele saiu com o
  prazo; a tela de privacidade e o guia de conformidade dizem o mesmo. Os argumentos das ferramentas
  continuam fora do prazo.
- **A exportação não muda.** Enquanto o resumo existir, o arquivo do telefone o traz; depois do prazo,
  traz o marcador, como já acontece com a fala expurgada.

## Quando revisar

- Quando alguém pedir que os argumentos de ferramenta também saiam com o prazo. (O resumo, pedido na
  emenda de 14/11, já sai.)
- Quando o registro de eventos da organização precisar de prazo próprio.
- Em qualquer caso, até 2027-05-12.

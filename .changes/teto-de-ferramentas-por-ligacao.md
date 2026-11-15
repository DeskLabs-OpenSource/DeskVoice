---
impact: nothing_changes
section: fixed
title: As ferramentas de escrita passam a ter teto por ligação
---

O `send_whatsapp` já se recusava a mandar mais de cinco mensagens numa mesma ligação, mas as outras ferramentas de escrita não tinham teto nenhum: uma conversa podia criar dezenas de pendências, tocar o sino da equipe repetidamente ou disparar o webhook da organização a cada pedido, porque quem está na linha fala e é o modelo que decide chamar a ferramenta. Agora o `runTool` — o ponto único por onde o modelo alcança qualquer ferramenta — recusa a chamada que passa do teto de sucesso daquela ligação, com limites de 5 para pendências, agendamentos e webhook e 3 para o aviso à equipe; a recusa chega ao modelo como `ok: false` com o que dizer em voz alta, e fica registrada como qualquer outro desfecho, sem executar a ferramenta uma vez sequer. Entrada inválida não gasta cota, e a contagem soma o que o banco já registrou com o que o processo acabou de fazer, porque o `tool_result` só é gravado depois que a ferramenta retorna e o modelo pede várias em paralelo. Nada muda para quem usa o produto: ligação normal não chega perto desses números.
Crédito: @webtecnica.

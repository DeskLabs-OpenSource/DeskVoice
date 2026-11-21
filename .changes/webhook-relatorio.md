---
impact: new_capability
section: added
title: Cada webhook pode receber o relatório de cada ligação, desligado de fábrica
---

Em Configurações › Integrações, cada webhook permitido ganha a caixa "Receber o relatório de cada ligação", desmarcada de fábrica: quem já instalou não recebe nada novo sem marcar. Marcada, o webhook recebe, depois que a ligação termina e a leitura (desfecho e análise) roda, um `POST` com o evento `call.report`: a ligação, o agente, a direção, o início, o fim, a duração, o motivo do fim, o desfecho, o resumo e a análise com a nota. O relatório é montado na hora da entrega e nunca leva token, chave nem o telefone de quem ligou; o sistema do outro lado liga o relatório à ligação pelo `callId`. Com o desfecho e a análise desligados, o relatório sai logo depois do resumo. Cada entrega vai com `Idempotency-Key` (a mesma em toda tentativa), sai uma vez por ligação e por webhook, tem três tentativas pela fila e aparece na linha do tempo da ligação como entregue ou não entregue, com o motivo (HTTP, sem resposta a tempo, endereço fora do ar). A falha na entrega não mexe na ligação nem nas outras rotinas. Ligação apagada a pedido de quem ligou não sai. Crédito: @melgarafael.

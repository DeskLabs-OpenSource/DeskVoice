---
impact: nothing_changes
section: fixed
title: O envio por WhatsApp pede confirmação no máximo 3 vezes por ligação
---

Numa ligação recebida, o `send_whatsapp` pede a um responsável que confirme o envio antes de mandar a mensagem, e cada pedido avisa a equipe. O teto de 5 mensagens por ligação contava só os envios feitos, então os pedidos negados não tinham limite, e quem estava na linha podia fazer a equipe receber aviso atrás de aviso. Agora, depois de 3 pedidos de confirmação na mesma ligação, aprovados ou não, o agente não pede de novo: diz que não consegue enviar, passa a informação por voz e, se for preciso, anota para a equipe. É o mesmo teto do pedido de aprovação (`request_approval`). Nada muda numa ligação normal. Crédito: @melgarafael.

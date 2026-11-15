---
impact: nothing_changes
section: changed
title: O pedido de aprovação registra qual ferramenta pediu
---

O evento `approval_requested` da linha do tempo passa a trazer `tool` quando o pedido vem de outra ferramenta que não o `request_approval`, como a confirmação de envio do `send_whatsapp`. O teto de 3 confirmações por ligação do `send_whatsapp` passa a contar por esse campo, e não mais pelo começo do texto da pergunta. Nada muda para quem usa. Crédito: @melgarafael.

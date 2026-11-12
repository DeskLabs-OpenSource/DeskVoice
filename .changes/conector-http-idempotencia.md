---
impact: nothing_changes
section: fixed
title: O aviso pelo WhatsApp leva uma chave de repetição, para o reenvio não duplicar a mensagem
---

A entrega do aviso é uma tarefa de fila com três tentativas: quando o destino recebia a mensagem mas a
resposta se perdia no caminho, a tentativa seguinte mandava o mesmo texto outra vez. Agora cada envio
vai com a chave de repetição igual ao id do próprio aviso, e quem recebe pode devolver o mesmo recibo
em vez de mandar duas vezes. Vale para os conectores de endereço do operador; o número conectado por QR Code não muda. Nada a fazer em instalações existentes. Crédito: @webtecnica.

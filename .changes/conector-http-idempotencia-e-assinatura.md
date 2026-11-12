---
impact: nothing_changes
section: fixed
title: O reenvio de um aviso deixou de poder duplicar a mensagem no WhatsApp
---

A entrega do aviso é uma tarefa de fila com três tentativas: quando o destino recebia a mensagem mas a
resposta se perdia no caminho, a tentativa seguinte mandava o mesmo texto outra vez. Agora cada envio
vai com a chave de repetição igual ao id do próprio aviso, e quem recebe pode devolver o mesmo recibo
em vez de mandar duas vezes. O corpo também passa assinado, com o token do conector como chave, para o
destino provar que o texto não mudou no caminho. Vale para os conectores de endereço do operador; o
número conectado por QR Code não muda. Nada a fazer em instalações existentes. Crédito: @webtecnica.

---
impact: nothing_changes
section: fixed
title: O agente do OpenAI Realtime deixa de pedir para repetir logo depois de ter respondido
---

Quando a guarda contra o silêncio fechava a vez de quem ligou à força e a pessoa seguia falando, o pedido "Desculpe, a linha está com bastante barulho. Pode repetir, por favor?" podia sair logo depois da resposta certa do agente. O provedor já preparava a resposta quando o prazo da guarda vencia, e o áudio dela ainda não tinha chegado. Numa ligação real pelo WhatsApp, a Helena respondeu ao pedido de marcar e, em seguida, pediu para a pessoa repetir. Agora, com o motor OpenAI Realtime, a guarda pergunta ao motor se a resposta já está a caminho e, se estiver, espera mais 4 segundos em vez de pedir. Se a resposta não tocar nesse tempo, o pedido sai como antes. No Gemini Live e no pipeline nada muda. Quem já instalou não precisa fazer nada. Crédito: @melgarafael.

---
impact: nothing_changes
section: fixed
title: No OpenAI Realtime, o motor passa a pedir o corte da fala interrompida no histórico
---

Quando quem ligou fala por cima do agente numa ligação pelo Asterisk com o motor OpenAI Realtime, o motor agora avisa o provedor até onde a fala foi enviada para a linha, para que o provedor corte o resto do histórico da conversa. Antes, o modelo seguia achando que tinha dito a frase inteira e podia dar por combinado algo que a pessoa nunca ouviu. O efeito numa ligação real ainda não foi conferido: se o provedor recusar o pedido, o erro vai para o registro, nada é cortado e a ligação segue como antes. O Gemini Live, a ligação pelo WhatsApp e a chamada de teste no navegador seguem como estavam. Nada a fazer ao atualizar. Crédito: @melgarafael.

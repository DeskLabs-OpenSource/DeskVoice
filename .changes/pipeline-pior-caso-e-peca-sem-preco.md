---
impact: nothing_changes
section: changed
title: O motor pipeline confere o pior caso antes de cada pedido ao cérebro e não abre com peça sem preço
---

Por dentro do DeskVoice, cada pedido do motor pipeline ao cérebro passou a levar um teto de saída, e antes de cada pedido o motor confere se o pior caso dele cabe no que sobra do teto de custo do agente. Se não cabe, o pedido não sai, e quem ligou ouve a despedida do teto, que já estava pronta e não custa nada a mais. Uma ligação pelo pipeline também não começa quando o modelo do cérebro ou a voz não têm preço conhecido, porque o custo não seria medido; a linha do tempo diz qual peça e qual modelo, nos três idiomas. A análise e o desfecho mandam ao cérebro o mesmo pedido de antes. Quem já instalou não vê nada novo e não precisa fazer nada: nenhum agente usa o pipeline e nenhuma tela o oferece. Crédito: @melgarafael.

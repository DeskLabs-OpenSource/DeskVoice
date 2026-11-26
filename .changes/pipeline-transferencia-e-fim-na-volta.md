---
impact: nothing_changes
section: changed
title: O motor pipeline avisa que vai transferir quando uma peça cai, e não deixa nada aberto quando a ligação acaba na volta da transferência
---

Por dentro do DeskVoice, quando uma peça do motor de voz em pipeline cai no meio da ligação e o agente tem número de transferência, quem ligou agora ouve que vai ser transferido, e não o pedido para ligar de novo. Essa fala fica pronta já na abertura, e é gerada só para o agente que transfere. A ligação que acaba enquanto volta de uma transferência não atendida fecha tudo o que estava abrindo, e nada é registrado depois do fim. O turno em que o agente falou antes de usar uma ferramenta deixa de ser marcado como turno com ferramenta. Quem já instalou não vê nada novo e não precisa fazer nada: nenhum agente usa o pipeline, e os outros motores não mudam. Crédito: @melgarafael.

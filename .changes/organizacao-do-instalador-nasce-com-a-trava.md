---
impact: nothing_changes
section: fixed
title: A organização criada pelo instalador nasce com a saída bloqueada, como a criada pela tela
---

Desde a 0.42.0, a organização nova criada em Organizações nasce com os padrões da instalação e, sem padrão escolhido, com a saída bloqueada até alguém desbloquear nos limites dela. A organização criada pelo instalador, a de quem instalou, nascia por outro caminho e ficava sem essa trava: só a escolha dela, desligada, segurava a saída. Agora as duas nascem pelo mesmo caminho: numa instalação nova, a organização de quem instalou nasce com a saída bloqueada, sem limite de linhas, de agentes e de gasto, e com o fuso e o idioma dos padrões. Para ligar para fora, quem instalou desbloqueia a saída em Administrar a instalação, Organizações, Limites, e depois liga a saída nas configurações da organização, como já se faz com as outras. Quem já instalou não é afetado: a atualização não mexe em organização nenhuma que já existe, nem liga nem trava nada. Crédito: @melgarafael.

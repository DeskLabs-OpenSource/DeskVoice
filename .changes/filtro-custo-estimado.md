---
impact: nothing_changes
section: fixed
title: O pedido do filtro da fala que falha grava um custo estimado, e não zero
---

Quando o filtro da fala de quem liga pergunta ao Jev e a resposta chega atrasada, não chega por
falta de rede ou chega fora da forma, o extrato de custo ganha uma linha com uma estimativa pelo
texto enviado, marcada como estimada, e ela entra no total da ligação e no teto de custo do agente.
Antes, esse pedido não deixava custo nenhum. O filtro continua nascendo desligado: quem não o
ligou não vê nada diferente, e as linhas que já estão no extrato ficam como estão. Nada muda em
instalações existentes. Crédito: @melgarafael.

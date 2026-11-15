---
impact: nothing_changes
section: added
title: Bancada de voz mede o acerto do Jev e do Laya com transcrição errada, fundo e fim do pensamento
---

O script manual `scripts/bancada-de-voz/` ganha um conjunto de texto inventado para o filtro, com a
resposta esperada de cada item: a leitura com o nome escrito errado pela transcrição (ou sem nome
nenhum), a fala de quem liga ou de fundo, e o pensamento completo ou a pausa. O Jev e o Laya
respondem aos mesmos pedidos, e a bancada conta o acerto por pergunta e quantas falas de quem liga
cada um marcou como fundo. O teto de gasto também para a medida quando um pedido custa mais que o
reservado. Nada disso roda no CI, entra na imagem ou muda uma instalação. Crédito: @melgarafael.

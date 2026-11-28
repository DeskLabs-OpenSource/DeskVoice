---
impact: nothing_changes
section: fixed
title: A linha do tempo da ligação guarda no máximo 4.000 caracteres dos argumentos de cada ferramenta chamada
---

Quando o agente chamava uma ferramenta com um texto enorme, os argumentos iam inteiros para a linha do tempo da ligação, mesmo quando a ferramenta recusava o texto ou nem estava ligada para o agente. Agora, acima de 4.000 caracteres, a linha do tempo mostra o nome da ferramenta e a marca `too_long` com o tamanho, sem nenhum pedaço do texto: nada é cortado. Os argumentos de tamanho normal continuam aparecendo inteiros, e o agente ouve a mesma resposta de antes. O que já estava gravado fica como está. Quem já instalou não precisa fazer nada. Crédito: @melgarafael.

---
impact: nothing_changes
section: changed
title: O upgrade do WebSocket da chamada pela web confere o convite antes de abrir
---

O endereço da chamada pelo navegador passa a conferir o convite antes de abrir o WebSocket. Pedido sem convite, com convite errado ou já usado recebe uma resposta HTTP comum (401, ou 404 fora do caminho da chamada) e nenhum WebSocket abre. A exceção é o convite vencido, na primeira tentativa e até 30 minutos depois do prazo: ele abre e fecha logo, com o código 4401, para a tela dizer que venceu. Depois disso, ou na segunda tentativa, nem abre. Quem liga pelo painel não percebe diferença na conversa. Nada a configurar. Crédito: @melgarafael.

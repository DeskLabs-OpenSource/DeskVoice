---
impact: nothing_changes
section: changed
title: O upgrade do WebSocket da chamada pela web confere o convite antes de abrir
---

O endereço da chamada pelo navegador passa a conferir o convite antes de abrir o WebSocket. Pedido sem convite válido recebe uma resposta HTTP comum (401, ou 404 fora do caminho da chamada) e nenhum WebSocket abre. Quem liga pelo painel não percebe diferença na conversa. Nada a configurar. Crédito: @melgarafael.

---
impact: new_capability
section: changed
title: A integração que não responde a tempo vira "não sei", e cada chamada leva uma chave de idempotência
---

Quando uma integração cadastrada não responde dentro do prazo durante a ligação, o agente deixa de tratar isso como erro: ele ouve que não se sabe se o pedido foi registrado, que não deve chamar de novo sem antes confirmar com a pessoa, e diz que vai verificar. A linha do tempo mostra a frase "não respondeu a tempo" no resultado da ferramenta. Erro HTTP e falha de rede seguem como antes. Toda chamada do agente a uma integração passa a levar o cabeçalho `Idempotency-Key`, igual para a mesma ligação, a mesma integração e os mesmos dados: o sistema do outro lado que respeita esse cabeçalho não registra o pedido duas vezes quando o agente repete; quem não o conhece simplesmente o ignora. Nada a configurar. Crédito: @melgarafael.

---
impact: nothing_changes
section: fixed
title: A mensagem de WhatsApp da ligação que caiu confere a lista de não ligar na hora do envio
---

Antes, a lista de não ligar era conferida só quando a ligação caía e a mensagem entrava na fila. Um
número posto na lista logo depois ainda recebia a mensagem. Agora a lista é conferida de novo na hora
do envio, e também a cada nova tentativa. Se o número está na lista, a mensagem não sai, nenhuma
pendência é aberta e a linha do tempo da ligação diz por que ela não saiu. Nada a configurar.
Crédito: @melgarafael.

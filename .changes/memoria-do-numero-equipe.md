---
impact: new_capability
section: added
title: A tela da chamada mostra as ligações anteriores do mesmo número
---

Quem atualiza passa a ver, na tela de cada chamada, o bloco "Este número": as ligações anteriores
do mesmo telefone (data, agente, desfecho e link) e as pendências abertas dele, sem procurar na
lista de Chamadas. Não há interruptor, porque é leitura do que a equipe já via (registro 0020). O
aviso de transferência e o de `notify_human` ganham uma linha como "Este número já ligou 3 vezes;
1 pendência aberta: …". Pelo WhatsApp, essa linha leva só as contagens, nunca o título da
pendência. Nada disso chega ao agente: as instruções e as ferramentas da ligação não mudam.
Chamada sem número não mostra o bloco, e a ligação apagada a pedido do titular não aparece. A
chamada simulada aparece na lista com a marca "Simulada" e não entra no "já ligou" dos avisos,
porque qualquer pessoa da equipe pode simular com o número de um cliente. Crédito: @melgarafael.

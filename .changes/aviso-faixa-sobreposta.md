---
impact: new_capability
section: added
title: Antes de salvar uma linha cuja faixa cruza a de outra organização, a tela de Linhas avisa e pede confirmação
---

Quando a instalação tem mais de uma organização e alguém salva uma linha cujo endereço (o servidor do provedor e, na linha por IP, os endereços extras) cruza a faixa de uma linha de outra organização, de modo que alguma linha por IP sairia do ar, a tela de Linhas para antes de salvar e diz que existe uma linha de outra organização na mesma faixa e que, salvando, as linhas por IP das duas param de receber chamadas até uma delas mudar o endereço. Salvar mesmo assim grava como antes; Voltar não grava nada. O aviso não diz qual linha, de que organização nem em que endereço. A regra é a mesma que o processo de voz já usava para deixar essas linhas de fora do arquivo do Asterisk, agora num lugar só. Nada muda para quem tem uma organização só, e mudar só o nome de uma linha nunca pergunta. Quem usa a API recebe `409` com `trunk_overlap_unconfirmed` e confirma com `confirmOverlap: true` no corpo. Crédito: @melgarafael.

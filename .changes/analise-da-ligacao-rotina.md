---
impact: new_capability
section: added
title: A ligação pode ser analisada no fim, na mesma chamada paga do desfecho
---

Esta é a segunda parte da análise da ligação no fim. Com a nova chave `calls.analysis_enabled` ligada, a rotina que lê o desfecho comercial passa a pedir, na mesma chamada ao provedor do agente, a análise completa: o cumprimento de cada critério da régua, a temperatura da conversa e as objeções de quem ligou. A nota é sempre a soma da régua, nunca um número do modelo. Objeção cuja citação não está numa fala de quem ligou, ou que tem menos de três palavras, é descartada. O custo entra uma vez no extrato e respeita o teto do agente. Quando a análise não é feita (sem fala, sem chave, motor simulado, teto atingido ou falha do provedor), a linha do tempo da chamada diz o motivo. Numa chamada apagada a pedido do titular, a nota fica e o texto da análise não é gravado. Só o dono ou um administrador liga a chave; a tela vem na próxima parte. Nada muda para quem atualiza: a chave nasce desligada, e quem usa só o desfecho continua recebendo exatamente o mesmo pedido, com o mesmo custo. Crédito: @melgarafael.

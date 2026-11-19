---
impact: nothing_changes
section: fixed
title: Na URA, a rota do anúncio recusa anúncio com menos de 200 ms, e a transferência que falha fica gravada como falha da URA
---

A rota que recebe o anúncio do menu por teclas passa a recusar o anúncio com menos de 200 ms (0,2 segundo), que tocaria como silêncio, com o código `ivr_prompt_too_short`: antes, só a tela recusava, e quem subia o WAV pela API conseguia salvar um anúncio mudo. A tela e a rota usam o mesmo limite. Quando o processo de voz não consegue transferir a ligação para a pessoa do menu, a chamada continua "Falhou", e o motivo gravado (`end_reason`, que a API devolve) passa a ser `ivr_failed`, em vez de `transferred`; a linha do tempo continua mostrando a transferência pedida, o fim da ligação e, depois, a frase "A transferência para a pessoa do menu não completou". Os anúncios já salvos não mudam. Nada a configurar. Crédito: @melgarafael.

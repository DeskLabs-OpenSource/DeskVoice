---
impact: nothing_changes
section: fixed
title: Na URA, a duração da ligação passada à IA conta desde o atendimento do menu, e a rota do anúncio recusa 199,9 ms
---

Quando a URA passa a ligação para um agente de IA, a hora de atendimento da chamada (`answered_at`, que a API devolve como `answeredAt`) fica sendo a hora em que a URA atendeu, e não mais a hora em que a IA começou a falar. A duração mostrada no painel passa a incluir o tempo no menu, que é o tempo que a pessoa passou na linha. A ligação sem URA não muda. As ligações já gravadas não mudam. A rota que recebe o anúncio do menu passava um áudio de 199,6 a 199,9 ms, porque arredondava a duração antes de comparar com o mínimo de 200 ms. Agora ela compara a duração medida, sem arredondar, e recusa esse áudio com `ivr_prompt_too_short`. Nada a configurar. Crédito: @melgarafael.

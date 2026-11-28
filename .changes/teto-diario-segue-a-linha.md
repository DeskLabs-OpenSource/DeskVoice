---
impact: nothing_changes
section: fixed
title: O teto diário de ligações de saída não zera quando a linha ou o número muda
---

Antes, trocar o número de uma linha telefônica no meio do dia zerava a contagem do teto diário de
ligações de saída daquela linha, e ela podia fazer outra leva de ligações. Agora cada ligação de
saída guarda a linha por onde saiu, e o teto do dia conta o que saiu pela linha ou pelo número que
ela usa agora, sem contar a mesma ligação duas vezes. Trocar o número, passar o número para outra
linha ou apagar a linha e criar outra com o mesmo número não devolve ligações ao teto no mesmo dia.
O teto fica um pouco mais estrito nesses casos de borda. As ligações feitas antes da atualização
herdam a linha cujo número é hoje o de saída delas. Nada a configurar. Crédito: @melgarafael.

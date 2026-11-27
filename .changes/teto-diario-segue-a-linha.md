---
impact: nothing_changes
section: fixed
title: O teto diário de ligações de saída segue a linha, e não o número dela
---

Antes, trocar o número de uma linha telefônica no meio do dia zerava a contagem do teto diário de
ligações de saída daquela linha, e ela podia fazer outra leva de ligações. Agora cada ligação de
saída guarda a linha por onde saiu, e o teto conta pela linha: trocar o número não devolve
ligações ao teto. As ligações feitas antes da atualização herdam a linha cujo número é hoje o de
saída delas. Nada a configurar. Crédito: @melgarafael.

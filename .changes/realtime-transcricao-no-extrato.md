---
impact: nothing_changes
section: fixed
title: A transcrição de quem ligou no motor OpenAI Realtime entra no extrato e no teto de custo
---

Toda ligação pelo motor OpenAI Realtime pede à OpenAI uma transcrição à parte da fala de quem ligou, com o modelo `gpt-4o-mini-transcribe`, e a OpenAI cobra essa transcrição pelo preço desse modelo. Até aqui, esse consumo não aparecia no extrato da ligação, nem contava para o teto de custo por ligação. Agora cada transcrição vira uma linha no extrato, no motor OpenAI Realtime e com o modelo da transcrição, soma ao custo da ligação e conta para o teto. Quando a OpenAI não informa o consumo, ele é estimado pelo áudio de quem ligou, e a linha sai marcada como estimada. O valor é pequeno, cerca de US$ 0,003 por minuto de fala, mas o custo das ligações pelo OpenAI Realtime fica um pouco maior que antes, porque agora mostra o que a OpenAI já cobrava. As ligações que já aconteceram não mudam. Quem já instalou não precisa fazer nada. Crédito: @melgarafael.

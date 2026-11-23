---
impact: new_capability
section: changed
title: Cada webhook permitido ganha o seu prazo de resposta, de 1 a 30 segundos
---

Em Configurações › Integrações, cada webhook permitido ganha o campo "Prazo de resposta (segundos)": quanto o agente espera o sistema do outro lado responder, de 1 a 30 segundos. O padrão continua 10 segundos, o de antes, e a lista que já estava gravada segue valendo com 10 segundos sem ninguém mexer. O prazo vale para toda chamada a esse webhook, durante a ligação e nas entregas depois dela. Durante a ligação, a pessoa fica na linha esse tempo; sem resposta no prazo, o agente diz que vai verificar, como já fazia. A API recusa prazo fora de 1 a 30 e devolve sempre o prazo que vale. Crédito: @melgarafael.

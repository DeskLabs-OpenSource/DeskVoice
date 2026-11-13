---
impact: new_capability
section: added
title: O agente aperta as teclas do menu automático em vez de pedir que a pessoa aperte
---

Ligação para fora esbarrava em menu automático: a URA da operadora ou do convênio pedia um número e
o agente só podia pedir a quem ligou que digitasse. Agora existe a ferramenta `send_dtmf`, que
entrega o tom ao canal pelo Asterisk (ARI) — e o rastro de cada tecla fica na chamada, para dar para
reconstruir o caminho depois. Na chamada simulada a ferramenta se recusa em vez de fingir que
apertou. Crédito: @webtecnica.

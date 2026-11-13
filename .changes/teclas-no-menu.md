---
impact: new_capability
section: added
title: O agente aperta as teclas do menu automático em vez de pedir que a pessoa aperte
---

Ligação para fora esbarrava em menu automático: a URA da operadora ou do convênio pedia um número e
o agente só podia pedir a quem ligou que digitasse. Agora existe a ferramenta `send_dtmf`, que toca
o tom de cada tecla na própria fala do agente, como faz um telefone, e o rastro de cada tecla fica
na linha do tempo da chamada. Funciona com o menu que reconhece o tom no áudio. O menu que só
aceita tecla enviada à parte, pela sinalização (RFC 4733 ou SIP INFO), não reconhece: isso foi
medido entre dois Asterisk, e ainda não há prova com a URA de uma operadora. Na ligação pelo
WhatsApp a ferramenta se recusa. O tom não entra na gravação da chamada, porque sai direto para a linha, sem passar pelo motor. Agentes que já existem não a ganham sozinhos: ela se liga na lista
de ferramentas do agente. Crédito: @webtecnica.

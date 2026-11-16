---
impact: new_capability
section: added
title: O agente pode abrir uma pendência quando a ligação cai no meio da conversa
---

A tela do agente ganha o bloco "Quando a ligação cai", com duas opções: "Não fazer nada", o
padrão, e "Abrir uma pendência para alguém retornar". Conta como queda a ligação recebida e atendida em que o sistema falhou, em que quem ligou ficou
alguns segundos sem resposta (além do prazo da guarda do silêncio) e desligou, ou em que a linha
caiu durante uma ação do agente. Quem desliga depois de se despedir, ou enquanto o agente fala, não
conta. Com a pendência escolhida, o supervisor abre uma por ligação, para o dono das pendências do
agente, e a linha do tempo diz o que aconteceu; o motor de voz que caiu continua abrindo a pendência
como hoje. Na ligação simulada, a linha do tempo diz o que teria acontecido, e nada é aberto. O fim
da ligação passa a registrar se a vez estava aberta quando quem ligou desligou. Todo agente que já existe fica em "Não fazer nada", e o
comportamento de hoje não muda. Crédito: @melgarafael.

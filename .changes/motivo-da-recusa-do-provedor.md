---
impact: nothing_changes
section: fixed
title: Quando o provedor de voz recusa a sessão, o aviso no painel traz o motivo que ele deu
---

Se o Gemini Live ou o OpenAI Realtime fechavam a conexão antes de confirmar a sessão, o aviso no
painel sobre a ligação recusada dizia só que a conexão fechou, e no Gemini ainda sugeria "chave ou
modelo inválido?", mesmo quando o motivo era outro. Agora o aviso leva o código e o motivo que o
provedor mandou, como "Your prepayment credits are depleted" quando o crédito pré-pago do Google
acabou. O cartão da ligação na linha do tempo continua mostrando só o tipo da recusa. Nada a fazer
em instalações existentes. Crédito: @melgarafael.

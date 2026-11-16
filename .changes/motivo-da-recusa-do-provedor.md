---
impact: nothing_changes
section: fixed
title: Quando o provedor de voz recusa a sessão, a ligação guarda o motivo que ele deu
---

Se o Gemini Live ou o OpenAI Realtime fechavam a conexão antes de confirmar a sessão, o registro
da ligação recusada dizia só que a conexão fechou, e no Gemini ainda sugeria "chave ou modelo
inválido?", mesmo quando o motivo era outro. Agora o registro leva o código e o motivo que o
provedor mandou, como "Your prepayment credits are depleted" quando o crédito pré-pago do Google
acabou. Nada a fazer em instalações existentes. Crédito: @melgarafael.

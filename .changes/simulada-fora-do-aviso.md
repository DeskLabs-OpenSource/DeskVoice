---
impact: nothing_changes
section: fixed
title: A pendência criada numa chamada simulada não entra mais no aviso do cliente real
---

Quando alguém da equipe simulava uma chamada com o número de um cliente e o agente abria uma
pendência, ela aparecia no aviso de transferência e no de `notify_human` desse cliente (no painel e
no WhatsApp) como se fosse dele. Agora o aviso só conta e só cita o que nasceu em ligação de verdade.
No bloco "Este número", a pendência e a nota nascidas numa simulada continuam aparecendo, com a
marca "Simulada", como a chamada simulada já aparecia. A pendência criada pela tela, sem ligação,
continua contando. Corrige a #291. Crédito: @melgarafael.

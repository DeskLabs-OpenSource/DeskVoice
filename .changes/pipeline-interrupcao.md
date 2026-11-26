---
impact: nothing_changes
section: changed
title: O motor pipeline para de falar quando quem ligou fala por cima, e guarda só o que o agente chegou a dizer
---

Por dentro do DeskVoice, o motor de voz em pipeline agora atende a interrupção. Quando quem ligou fala por cima da resposta do agente, a voz e o pedido ao modelo param, e a fala do agente fica na conversa só até onde ela saiu. A próxima resposta segue do que a pessoa disse. O ruído sem palavra não corta o agente, e a despedida nunca é cortada. O que já tinha sido enviado à voz e ao modelo continua no extrato e conta para o teto. Também entram três acertos da etapa anterior: a fala de aviso só promete transferência quando a ligação vai mesmo ser transferida, a despedida do teto segue a mesma regra, e a fala gerada numa abertura que terminou depois do fim da ligação entra no extrato. Quem já instalou não vê nada novo e não precisa fazer nada: nenhum agente usa o pipeline, e os outros motores não mudam. Crédito: @melgarafael.

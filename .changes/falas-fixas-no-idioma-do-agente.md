---
impact: nothing_changes
section: fixed
title: Voz — as falas fixas do sistema saem no idioma do agente
---

Um agente com o motor pipeline configurado em inglês (`en-US`) ou espanhol (`es-MX`) falava em português as frases que o próprio sistema diz: o "Você ainda está aí?" e o lembrete depois dele, a despedida de quem ficou calado, o "pode repetir?" da linha com barulho, as despedidas do tempo máximo e do teto de custo, e as falas de falha técnica e de transferência. Agora cada uma delas sai no idioma do agente da ligação: "Are you still there?" em inglês, "¿Sigue ahí?" em espanhol. Na passagem entre agentes, vale o idioma de quem recebe a ligação. Em português e em qualquer outro idioma, a frase é a mesma de antes. Na despedida do teto, a fala continua saindo pronta, sem síntese nova. O aviso de gravação e a saudação são textos do operador e não mudam. Contexto: a observação do Verificador 2 no #583. Crédito: @deskcomm-bot.

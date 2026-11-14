---
impact: new_capability
section: added
title: O ambiente de quem liga, normal ou barulhento, agora se escolhe na tela do agente
---

Na tela do agente, junto do motor, da voz e do idioma, há o campo "Ambiente", com duas opções: "Normal" e "Barulhento (obra, música, conversa de fundo)". Ele grava o mesmo `listeningEnvironment` que a API de agentes já aceitava. Por enquanto, "Barulhento" é só para o motor OpenAI Realtime, o único em que a sessão foi provada numa instalação real; ele ainda não foi provado no Gemini Live. Em outro motor, a opção não aparece. Um agente que já está em "Barulhento" e troca de motor continua vendo o campo, com um aviso e um botão para voltar a "Normal". A API segue aceitando o valor em qualquer motor. Com "Barulhento", o agente fica menos sensível a ruído para começar a ouvir; o efeito numa ligação de verdade ainda não foi medido. Os textos estão em português, inglês e espanhol. Nada muda para quem atualiza: todo agente continua em "Normal" até alguém escolher outra opção. Crédito: @melgarafael.

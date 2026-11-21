---
impact: new_capability
section: added
title: A tela da ligação mostra quanto o agente demorou para responder
---

Nos motores OpenAI Realtime e Gemini Live, a linha do tempo de cada ligação ganha uma linha no fim: em quanto tempo o agente respondeu em metade dos turnos, quanto levou a resposta mais lenta e quantos turnos entraram na conta. A espera conta do fim da fala de quem ligou até o primeiro som do agente na linha. Ficam de fora os turnos em que uma ferramenta rodou (a espera ali é do sistema chamado, e não do motor), a resposta que o DeskVoice forçou quando o agente ficou calado e as falas do próprio sistema, como o aviso de gravação e a despedida. No Gemini Live, a linha diz que a medida é aproximada: o Google não avisa quando a fala termina, e o marco é a transcrição, que chega um pouco depois, então a espera real é um pouco maior. É um registro por ligação, guardado no banco da própria instalação, sem nada enviado para fora. Nada muda na conversa, e nada a fazer ao atualizar. Os números foram conferidos com motor de teste e servidor falso, não numa ligação real. Crédito: @melgarafael.

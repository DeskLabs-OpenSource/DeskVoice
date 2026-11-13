---
impact: nothing_changes
section: fixed
title: O som que vai ao Gemini, e a voz do agente no WhatsApp, deixam de ter chiado falso acima de 4 kHz
---

Ao converter o áudio da chamada de 8 para 16 kHz, o DeskVoice criava cópias espelhadas da voz entre
4 e 8 kHz, a faixa do chiado de "s", "ç", "f" e "x", e abafava o topo da faixa telefônica (3 a
4 dB perdidos em 3 kHz). Isso acontecia no áudio de quem liga enviado ao Gemini Live e na fala do
agente enviada ao WhatsApp. Agora a conversão filtra: as cópias ficam mais de 50 dB abaixo da voz
e o som até 3 kHz chega sem perda. Nada a configurar. O efeito no reconhecimento de fala do
provedor ainda não foi medido. Crédito: @melgarafael.

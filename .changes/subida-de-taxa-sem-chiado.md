---
impact: nothing_changes
section: fixed
title: O som que vai ao Gemini, e a voz do agente no WhatsApp, têm bem menos chiado falso acima de 4 kHz
---

Ao converter o áudio da chamada de 8 para 16 kHz, o DeskVoice criava cópias espelhadas da voz entre
4 e 8 kHz, a faixa do chiado de "s", "ç", "f" e "x", só 4 a 28 dB abaixo da voz. Ele também abafava
o topo da faixa telefônica (3 a 4 dB perdidos em 3 kHz). Isso acontecia no áudio de quem liga
enviado ao Gemini Live e na fala do agente enviada ao WhatsApp. Agora a conversão filtra. Do jeito
que o produto converte, em pedaços de 20 ms, as cópias ficam mais de 40 dB abaixo da voz, e o som
até 3 kHz chega sem perda. O limite que resta é a junção entre os pedaços, convertidos um a um:
ela deixa um resíduo entre 26 e 42 dB abaixo da voz, menor que o de antes em todos os tons medidos.
Nada a configurar. O efeito no reconhecimento de fala do provedor ainda não foi medido. Crédito:
@melgarafael.

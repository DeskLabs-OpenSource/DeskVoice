---
impact: nothing_changes
section: added
title: Bancada de voz mede a redução de ruído por quadro, debaixo de ruído e em fluxo
---

A medida manual da redução de ruído na bancada de voz (`scripts/bancada-de-voz/`) passa a medir a
fala baixa quadro a quadro (o quarto mais fraco dos quadros de 20 ms com fala, acima de 1 dB de
perda média reprova), a mesma fala baixa debaixo de obra, música e conversa de fundo, e a CPU com o
áudio entregue em pedaços de 20 ms, um de cada vez, como a ponte manda. Só RNNoise e DeepFilterNet;
o DeepFilterNet em fluxo usa o plugin de tempo real que o próprio projeto publica, baixado à parte.
Nenhum deles entra no produto: não roda no CI, não entra na imagem e não muda nada numa instalação.
Crédito: @melgarafael.

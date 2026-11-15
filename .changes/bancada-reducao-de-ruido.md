---
impact: nothing_changes
section: added
title: Bancada de voz mede a redução de ruído local em 8 kHz, fora do produto
---

A bancada de voz (`scripts/bancada-de-voz/`) ganha uma medida manual da redução de ruído que
poderia rodar na VPS antes do provedor: SpeexDSP, RNNoise e DeepFilterNet, em áudio de telefone
(8 kHz) com voz sintética e ruído gerado. Ela mostra o atraso, a CPU, quanto cada um tira de obra,
música e conversa de fundo, e quanto corta da fala baixa. Nenhum deles entra no produto: não roda
no CI, não entra na imagem e não muda nada numa instalação. Crédito: @melgarafael.

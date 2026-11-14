---
impact: nothing_changes
section: added
title: Bancada de voz para medir transcritores, fora do produto
---

O repositório ganha um script manual em `scripts/bancada-de-voz/` que mede como cada serviço de
transcrição ouve português: erro de palavra, acerto exato em nomes (com acento e cedilha), latência
até o texto parcial e até o final, e custo, na linha de telefone (8 kHz) e na banda larga (16 kHz),
com voz sintética e ruído gerado, sempre enviada em tempo real. Ela não roda no CI, não entra na
imagem e não muda nada numa instalação. Crédito: @melgarafael.

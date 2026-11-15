---
impact: nothing_changes
section: added
title: Bancada de voz mede Deepgram, AssemblyAI, Soniox e o Jev, fora do produto
---

O script manual `scripts/bancada-de-voz/` ganha três serviços externos de transcrição em streaming
(Deepgram Nova-3, AssemblyAI Universal-Streaming multilíngue e Soniox), cada um com o
vocabulário pelo recurso do próprio serviço, e o Jev como modelo de decisão, com as mesmas
perguntas do Laya. Cada um só roda com a chave entregue à bancada, para antes do teto de gasto e
diz quanto gastou. Nada disso roda no CI, entra na imagem ou muda uma instalação. Crédito: @melgarafael.

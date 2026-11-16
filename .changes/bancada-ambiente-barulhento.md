---
impact: nothing_changes
section: added
title: Bancada de voz prepara o antes e depois do ambiente barulhento contra o OpenAI e o Gemini
---

Uma medida manual nova na bancada de voz (`scripts/bancada-de-voz/ambiente-barulhento.ts`) toca
para cada motor de hoje, no ritmo de uma ligação, frases sintéticas no meio de obra, música e
conversa, nos modos "normal" e "barulhento", com e sem a guarda contra o silêncio. Ela mede o tempo
até o agente responder, conta as interrupções falsas pelo evento do motor e confere que a guarda
não fala por cima de uma frase longa. Exige um teto de gasto e, sem a chave do motor, não gera áudio
nem abre sessão. Ainda não rodou contra o provedor: espera a chave. Nada muda numa instalação: não
roda no CI e não entra na imagem. Crédito: @melgarafael.

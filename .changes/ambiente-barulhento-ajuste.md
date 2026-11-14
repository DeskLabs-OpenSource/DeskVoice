---
impact: new_capability
section: added
title: O agente pode ser ajustado para quem liga de lugar barulhento, por enquanto só pela API
---

Cada agente ganha o ambiente de quem liga, `normal` ou `noisy` (barulhento: obra, música, pessoas falando). Ele se grava pela API de agentes (`listeningEnvironment` em `POST` e `PATCH /api/v1/agents`), que recusa qualquer outro valor; sem o campo, fica `normal`. Com `noisy`, o agente pede ao provedor uma detecção de fala ajustada para ruído de fundo: no OpenAI Realtime, redução de ruído e fim de turno pelo sentido da fala; no Gemini Live, início de fala menos sensível e fim de fala que não espera o ruído acabar. A fala de verdade continua interrompendo o agente. Os valores são um ponto de partida: o efeito numa ligação de verdade ainda não foi medido. O campo na tela do agente vem na próxima parte. Nada muda para quem atualiza: todo agente nasce `normal`, e no `normal` o agente envia ao provedor exatamente o mesmo de antes, até alguém escolher "barulhento". Crédito: @melgarafael.

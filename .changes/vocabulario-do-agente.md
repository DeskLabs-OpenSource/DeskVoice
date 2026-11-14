---
impact: new_capability
section: added
title: O agente guarda os nomes e termos que podem aparecer na ligação, por enquanto só pela API
---

Cada agente ganha uma lista de vocabulário: nomes de pessoa, da empresa, de produtos e termos que quem liga costuma dizer, até 50, de 1 a 60 caracteres cada, sem repetição. Ela se grava pela API de agentes (`vocabulary` em `POST` e `PATCH /api/v1/agents`), que recusa termo fora da regra dizendo o motivo. Na chamada, os termos vão ao provedor como dica: no Gemini Live, à lista de vocabulário da transcrição; no OpenAI Realtime, ao texto de apoio da transcrição; nos dois, também à instrução do agente. É uma dica, que o provedor pode ignorar, e o efeito no reconhecimento ainda não foi medido. O campo na tela do agente vem na próxima parte. Nada muda para quem atualiza: a lista nasce vazia, e agente sem termos envia ao provedor exatamente o mesmo de antes. Crédito: @melgarafael.

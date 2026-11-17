---
impact: nothing_changes
section: added
title: Para quem contribui, uma skill nova para afinar um agente de voz com dados da operação
---

Nada muda para quem opera uma instalação: isto é para quem clona o projeto e trabalha com um
assistente de código. A skill `deskvoice-agente-de-voz` atende o "as respostas da IA estão ruins":
diagnostica pela análise da ligação, pela linha do tempo e pela configuração do agente, sem tirar
transcrição nem telefone da instalação; revisa as instruções para a fala (frases curtas, sem
formatação, número e e-mail ditos, uma fala para quando algo falha); só troca o texto depois de
mostrar o antes e o depois e receber o sim da pessoa; e ensina a medir o efeito pela análise das
ligações antes e depois da troca, sem afirmar que melhorou. O vocabulário do agente, que ainda não
tem campo na tela, é tratado como uma dica que o provedor pode ignorar, e a skill não o troca até a
tela existir: registra a lista aprovada para aplicar depois. A skill de métricas passa a
apontar para ela. Crédito: @melgarafael.

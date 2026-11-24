---
impact: nothing_changes
section: changed
title: A chamada pelo navegador abre o motor pipeline pelo mesmo caminho do telefone, e o pipeline simulado entra na prova de cada mudança
---

Por dentro do DeskVoice, a chamada pelo navegador passou a abrir o motor de voz em pipeline do mesmo jeito que a ligação pelo telefone: um agente com transcrição, cérebro e voz escolhidos é atendido pela mesma abertura, com o mesmo teto de custo, as mesmas linhas no extrato por peça e as mesmas recusas (sem chave, sem preço conhecido ou sem a confirmação de envio da voz). A cada mudança, o teste automático agora faz uma ligação inteira pelo pipeline simulado, com a saudação, uma fala, a resposta e o fim, e confere que quem respondeu foi o pipeline. As peças simuladas continuam aceitas só nos testes: nenhuma variável de um servidor instalado as liga. Também entram os testes de tela do bloco Pipeline: o botão Ouvir avisa quando a amostra não toca, e salvar um agente nunca leva a escolha do Pipeline. Quem já instalou não vê nada novo e não precisa fazer nada: o Pipeline continua desligado na tela, e nenhum agente o usa. Crédito: @melgarafael.

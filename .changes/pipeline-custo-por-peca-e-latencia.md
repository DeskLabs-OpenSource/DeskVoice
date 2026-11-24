---
impact: nothing_changes
section: changed
title: O custo de cada peça do pipeline no detalhe da chamada e em Custos, e o tempo de resposta medido ao lado da escolha
---

Na chamada que passou pelo motor de voz em pipeline, o detalhe da chamada mostra quanto custou a transcrição, o cérebro e a voz, cada um com o nome e o modelo, e a tela de Custos soma o mesmo por peça. O custo que não pôde ser medido aparece como "não medido", e nunca como zero. Na tela do agente, o bloco Pipeline mostra quanto o agente leva para responder (a mediana das últimas ligações), com os turnos que usaram ferramenta à parte e um aviso quando passa da meta; sem ligação medida, ele diz que ainda não há medida. Por dentro, a ligação recusa as peças simuladas de teste fora da configuração de teste, e o pipeline deixa de fazer um pedido a mais ao cérebro depois do fim pedido por ferramenta. Quem já instalou não vê nada novo e não precisa fazer nada: o Pipeline continua desligado na tela, nenhum agente o usa, e as chamadas dos outros motores não mudam no detalhe nem em Custos. Crédito: @melgarafael.

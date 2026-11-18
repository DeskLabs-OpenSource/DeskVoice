---
impact: new_capability
section: added
title: Cada agente pode ter o seu cérebro para ler as ligações
---

Quem lê a ligação depois que ela termina (o desfecho e a análise) agora pode ser escolhido em cada agente, pela API (`PATCH /api/v1/agents/<id>`, campo `analysisBrain`): igual à organização, que é o padrão; o motor de voz do próprio agente, mesmo com um cérebro escolhido em Configurações; ou um cérebro e um modelo da lista guardada, com a mesma conferência de Configurações (chave salva, modelo na lista, modelo sem preço só confirmando). Assim, Vendas pode ser lido por um modelo e Suporte por outro, e o extrato de cada ligação mostra o modelo e o custo do próprio agente. A escolha do agente vale sozinha: se a chave do cérebro dele for removida ou o modelo sair da lista, a ligação não é lida e a linha do tempo diz por quê, sem passar para a escolha da organização nem para o motor. O teto de custo e o modelo sem preço seguem as regras de hoje, pelo teto do agente. A lista de cérebros passa a dizer quais agentes escolheram cada um. Todo agente que já existe segue a organização, e nada muda sem você mexer. A escolha na tela do agente vem em seguida. Crédito: @melgarafael.

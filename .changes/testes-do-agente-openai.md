---
impact: nothing_changes
section: added
title: O teste do agente roda no OpenAI Realtime, em texto, e o custo dele entra no extrato e no teto do mês
---

O teste escrito de um agente agora pode rodar contra o próprio motor OpenAI Realtime do agente, com a chave da organização: o que quem liga diz vai como texto, o agente responde em texto, com as mesmas instruções e ferramentas da ligação, e nenhuma ferramenta roda de verdade. O teste abre como uma ligação recebida: o agente fala primeiro o aviso de gravação e a saudação, e essa resposta também conta no custo. A ligação de verdade segue montando a sessão como antes, agora pelo mesmo arquivo do teste. O custo de cada resposta vai ao extrato com a fonte "teste", sem ligação, entra na soma do mês, na visão da instalação e no teto de gasto, e a rodada para se passar do teto de custo por ligação do agente. A rodada é recusada, sem gastar nada, quando o teto do mês já foi alcançado, quando já há outro teste rodando na organização, quando o motor do agente ainda não roda testes ou quando falta a chave dele; uma rodada que ficou presa por mais de 7 minutos é fechada como erro e não trava as outras. Apagar um teste ou uma rodada não apaga o custo do extrato, porque o dinheiro foi gasto. Ainda não há tela, e o Gemini Live ainda não roda testes. Quem já instalou não vê mudança nenhuma até rodar um teste. Crédito: @melgarafael.

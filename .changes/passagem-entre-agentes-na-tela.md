---
impact: new_capability
section: added
title: O agente passa a ligação para outro agente no meio da conversa
---

Na tela do agente, "Pode passar a ligação para" lista os outros agentes da organização, com nome e
papel. Marcado um deles, o agente pode passar a ligação para ele no meio da conversa: a sessão do
próximo abre antes de a atual fechar, e ele continua a partir de um resumo, com as instruções, as
ferramentas, a voz e o motor dele. A regra de quando passar fica escrita nas instruções, são no
máximo 3 passagens por ligação, o tempo e o teto de custo continuam sendo os da ligação, e o custo de
cada trecho fica com o agente em que ela estava. A linha do tempo mostra a passagem (de quem, para
quem, o motivo e o resumo recolhido), e as falas seguintes levam o nome do novo agente. Apagar um
agente o tira da lista dos outros, que continuam editáveis; a chamada simulada usa o motor simulado
também no agente que recebe, sem custo de provedor; e quem desliga durante a troca tem a ligação
solta na hora. A passagem foi provada só com o motor simulado, ainda não numa ligação com provedor
de voz; se o provedor recusar a sessão do próximo agente, o agente atual continua na linha. A lista
vem vazia, e quem não marcar nada não vê mudança no atendimento. Crédito: @melgarafael.

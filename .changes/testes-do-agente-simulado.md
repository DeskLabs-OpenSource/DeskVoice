---
impact: nothing_changes
section: added
title: O pnpm demo termina rodando um teste do agente, a base dos testes que vão chegar à tela
---

Depois da ligação simulada de sempre, o `pnpm demo` roda um teste escrito da Lia: duas falas de quem liga, em texto, e o que se espera dela em cada uma (qual ferramenta pedir, com que argumentos, e o que dizer ou não dizer). No fim, imprime "Teste da Lia: passou" ou "reprovou", e cada reprovação vem com o esperado e o que veio, lado a lado. Num teste, nenhuma ferramenta roda: o teste devolve ao agente a resposta escrita nele, e nenhum webhook, aviso, pendência ou transferência sai. A rodada fica guardada no banco da própria instalação, com um retrato da configuração do agente, e cada teste guarda as 20 rodadas mais novas; se o processo de voz reiniciar no meio de uma rodada, ela é fechada como erro na partida. Esta é só a base: por enquanto o teste roda apenas no motor simulado, que segue um roteiro e não interpreta as instruções, então ele prova a tubulação e o juiz, e não o que um modelo de verdade faria. Ainda não há tela nem custo, e quem já instalou não vê mudança nenhuma. A versão com o motor real do agente e a tela vêm depois. Crédito: @melgarafael.

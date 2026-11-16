---
impact: new_capability
section: changed
title: Custos e a tela da chamada mostram quanto cada agente gastou numa ligação com passagem
---

Numa ligação passada de um agente para outro, a tela de Custos põe o custo de cada trecho no agente
em que a ligação estava, e não mais tudo no que atendeu. Se o agente de um trecho for apagado, o
custo desse trecho volta para o agente que atendeu; só fica em "Agente apagado" quando o que atendeu
também foi apagado. A tela da chamada segue a mesma regra. Uma ligação com passagem conta para cada
agente na contagem de chamadas, e a tela diz isso. Os minutos de cada motor de voz também saem dos
trechos: uma ligação que começou num motor e passou para um agente de outro motor divide a duração
entre os dois. A tela da chamada mostra, abaixo do custo, quanto cada agente gastou, quando a
ligação passou por mais de um. O total do período não muda. Quem nunca usou a passagem vê Custos
igual a antes; a passagem gravada antes desta versão continua com os minutos inteiros no motor que
atendeu, porque o evento dela não guardava o motor. Apagar dois agentes de uma vez não recusa mais a
limpeza da lista "Pode passar a ligação para". Crédito: @melgarafael.

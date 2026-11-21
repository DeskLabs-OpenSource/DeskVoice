---
impact: nothing_changes
section: fixed
title: Um limite padrão gravado acima do teto não impede mais criar uma organização, e "Ela nasce com" fala 1 no singular
---

Se alguém gravou à mão, em `defaults.limits`, um número acima do teto que a tela aceita (1 milhão de linhas telefônicas ou de agentes, ou 2.147.483.647 centavos de teto do mês), a criação de uma organização falhava com um erro genérico. Agora esse campo volta ao valor de fábrica, "sem limite", como já volta um campo com tipo errado. Os outros campos da chave continuam valendo, e a seção "Padrões para organizações novas" mostra com o que a organização nasce de verdade. A tela e o núcleo passam a conferir o mesmo teto. A frase "Ela nasce com" agora diz "até 1 linha telefônica" e "até 1 agente" (e o mesmo em inglês e espanhol), em vez do plural, e a recusa de criar além do limite também ("já tem 1 linha telefônica", "já tem 1 agente"). Crédito: @melgarafael.

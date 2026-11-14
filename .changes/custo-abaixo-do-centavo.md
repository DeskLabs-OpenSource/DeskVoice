---
impact: nothing_changes
section: fixed
title: A classificação da ligação deixa de custar 1 centavo quando custa 0,03, e o total do mês para de ser trinta vezes o real
---

Cada ligação lida para descobrir o desfecho custa cerca de 0,03 centavo de dólar ao provedor, mas o DeskVoice arredondava essa leitura para um centavo inteiro antes de somar: a chamada ficava até trinta vezes mais cara do que a fatura e o total do mês, na tela de custos, também. Agora o extrato guarda o valor exato da leitura em micro-centavos (1 centavo = 1 000 000), a chamada mostra a soma do extrato arredondada uma vez só e a tela de custos soma o período inteiro antes de arredondar. O teto de custo do agente continua valendo, na mesma unidade de centavos, e o valor arrecadado não é zerado em lugar nenhum: quem quiser ver a fração continua vendo no extrato. As leituras já gravadas continuam valendo 1 centavo cada, porque o valor exato delas não foi guardado; só as feitas depois da atualização saem exatas. Nada a fazer em instalações existentes, e nenhuma configuração muda. Crédito: @webtecnica.

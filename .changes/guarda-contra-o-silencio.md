---
impact: nothing_changes
section: fixed
title: Com barulho na linha, o agente não fica mais calado esperando a pessoa terminar de falar
---

Quando quem liga está num lugar com obra, música ou outras pessoas falando, o provedor de IA às vezes
não percebe que a pessoa terminou de falar, e o agente ficava em silêncio, como se a ignorasse. Agora
o DeskVoice percebe que a pessoa falou e ficou sem resposta. Cerca de 2,5 segundos depois da última
palavra (8 segundos se o provedor ainda não mandou texto nenhum), ele pede ao provedor que responda
ao que ouviu. Se o agente continuar calado por mais 4 segundos, ele diz "Desculpe, a linha está com
bastante barulho. Pode repetir, por favor?", no idioma do agente. Ele age uma vez por fala e nunca
pede de novo sem que a pessoa diga algo antes. Não age enquanto a pessoa ainda fala, nem durante uma
ferramenta ou uma aprovação em espera. Cada vez que age, a linha do tempo da chamada mostra. Vale
para todos os agentes, sem nada a configurar. Os prazos são um ponto de partida e ainda não foram
medidos com os provedores. Crédito: @melgarafael.

---
impact: nothing_changes
section: added
title: A API do agente grava as peças do motor pipeline, e recusa a escolha sem preço ou sem confirmação
---

Por dentro do DeskVoice, a API do agente agora aceita o campo `pipeline`, com a transcrição, o cérebro e o modelo, e a voz que o agente vai usar no motor de voz em pipeline, e o devolve na leitura. A escolha só é gravada quando cada peça existe, quando o cérebro conversa, quando o modelo dele e a voz têm preço conhecido, e quando a peça que leva o dado de quem ligou para fora do servidor já foi confirmada em Configurações → Voz. Se faltar alguma coisa, a resposta diz qual peça e por quê, e nada é gravado. A ligação de um agente com a escolha gravada fora da forma passa a ser recusada com um aviso claro no painel. Quem já instalou não vê nada novo e não precisa fazer nada: a tela não muda, nenhum motor novo aparece na lista, e o agente sem `pipeline` segue exatamente como era. Crédito: @melgarafael.

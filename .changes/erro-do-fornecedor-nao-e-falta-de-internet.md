---
impact: nothing_changes
section: fixed
title: O erro do fornecedor não aparece mais como falta de internet
---

Quando o fornecedor de voz, de cérebro, de motor ou do filtro de fala responde com erro do lado dele
(um 5xx, como na queda da ElevenLabs de 18/11), o teste da chave agora diz que o fornecedor
respondeu com erro do lado dele e que costuma passar sozinho, para tentar de novo em alguns minutos.
A linha do tempo diz só que o fornecedor respondeu com erro do lado dele. Antes, a tela dizia que ele
não foi alcançado e mandava conferir a internet do servidor. Quando de fato não há resposta, a frase
de conferir a rede continua a mesma. Nada a fazer: os testes de chave já gravados mantêm a frase
antiga até o próximo teste. Relatado pelo Rafael. Crédito: @melgarafael.

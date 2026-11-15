---
impact: nothing_changes
section: fixed
title: Uma falha ao calcular a impressão digital não faz mais a gravação contar como perdida
---

A impressão digital (SHA-256) é calculada lendo o arquivo depois que a gravação fecha. Se essa leitura falhasse, a gravação inteira contava como falha: na ligação, o log dizia que o áudio não tinha sido salvo, embora o arquivo existisse; no recado da caixa postal, a chamada virava recado com falha, e o arquivo ficava solto no disco. Agora a falha fica só na impressão: a gravação conta como salva, e a linha do tempo diz que a impressão não pôde ser calculada. Crédito: @melgarafael.

---
impact: nothing_changes
section: added
title: A voz da ElevenLabs existe como peça do motor, ainda sem tela
---

Nada muda numa instalação em funcionamento: nenhum agente usa a voz nova, e nenhuma tela a oferece. A ElevenLabs entra como uma peça do motor de voz: recebe o texto aos pedaços e devolve o áudio no formato do telefone. O custo é contado pelos caracteres enviados, com o preço publicado pela ElevenLabs e a data em que ele foi conferido, e é sempre marcado como estimado, porque a ElevenLabs não informa o consumo na resposta. Uma fala interrompida cobra o que já tinha sido enviado. A função `prepareFixedSpeech` também fica disponível: ela sintetiza de uma vez um conjunto de falas fixas, guarda o áudio na memória, separado por organização, e trata qualquer falha, inclusive a chave recusada, como recusa de abertura. Crédito: @melgarafael.

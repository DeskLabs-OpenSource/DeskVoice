---
impact: nothing_changes
section: fixed
title: Quando a gravação falha no meio da chamada, a linha do tempo mostra
---

Se o disco enchesse ou desse erro durante uma chamada gravada, a gravação daquela chamada se perdia e o aviso ficava só no registro do processo de voz: quem olhava a linha do tempo não sabia que não havia áudio. Agora a linha do tempo mostra "Gravação interrompida" no momento da falha, com o motivo (disco cheio, erro de escrita ou disco lento demais), e a chamada segue normalmente, sem gravar o resto. O arquivo incompleto é apagado no fim, como antes. Com o disco lento, as escritas pendentes da gravação também tinham deixado de ter limite em memória: agora, quando mais de 10 segundos de áudio esperam para ir ao disco, a gravação é encerrada do mesmo jeito, e a chamada não é afetada. A gravação vem desligada de fábrica. Nada a fazer em instalações existentes. Crédito: @melgarafael.

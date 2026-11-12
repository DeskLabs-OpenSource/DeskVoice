---
impact: nothing_changes
section: fixed
title: A gravação para no fim da chamada, sem a fala do agente que quem ligou não chegou a ouvir
---

O motor de voz manda a fala do agente mais rápido do que ela toca, e a gravação a guardava inteira assim que chegava. Quando a chamada terminava com fala ainda na fila (quem ligou desligou, ou a chamada caiu), essa fala, que ninguém ouviu, entrava no fim do arquivo: numa chamada medida na 0.6.0, de 64 s, o arquivo tinha 75 s, com 11 s de agente depois do fim. Agora a gravação corta a fala do agente no momento em que a chamada termina, como já fazia quando quem ligou interrompia. **Gravações feitas na 0.6.0 podem ter esse trecho a mais no fim**: a fala do agente que está depois do horário de fim da chamada, na linha do tempo, não foi ouvida por quem ligou. A gravação vem desligada de fábrica; só quem a ligou tem arquivos assim. Nada a fazer em instalações existentes. Crédito: @melgarafael.

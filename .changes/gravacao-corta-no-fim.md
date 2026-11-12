---
impact: nothing_changes
section: fixed
title: Quando quem ligou desliga com o agente ainda falando, a gravação para ali
---

O motor de voz manda a fala do agente mais rápido do que ela toca. Quando quem ligou desligava no meio de uma fala do agente, a gravação guardava também o resto dessa fala, que não chegou a tocar para ninguém, depois do horário de fim da chamada. Agora, nesse caso, a gravação corta a fala do agente no momento em que quem ligou desligou, como já fazia quando quem ligou interrompia. Quando é o agente que encerra a chamada, ou ela é transferida, nada muda: a telefonia toca a fala inteira antes de soltar a linha, e a gravação a guarda inteira. **Gravações feitas na 0.6.0 em que quem ligou desligou com o agente falando podem ter esse trecho a mais no fim**, depois do horário de fim da chamada na linha do tempo. A gravação vem desligada de fábrica. Nada a fazer em instalações existentes. Crédito: @melgarafael.

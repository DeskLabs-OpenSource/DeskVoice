---
impact: nothing_changes
section: fixed
title: A chamada simulada anda no ritmo de uma ligação
---

Na chamada simulada (painel e `pnpm demo`), a fala do agente agora toca no tempo dela: quem "ligou" só responde depois de ouvir a fala inteira, e ao encerrar ou transferir a chamada espera a última fala terminar, como já acontecia nas ligações reais. Antes, o roteiro corria com o agente ainda falando, a fala acumulava e a gravação da chamada simulada mostrava fala depois do fim (issue #111). A demonstração do painel fica mais longa, perto da duração de uma ligação de verdade. Nada a configurar em instalações existentes. Crédito: @melgarafael.

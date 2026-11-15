---
impact: nothing_changes
section: fixed
title: Com a transcrição automática ligada, o dono é avisado da ligação mesmo quando a transcrição falha de vez
---

Com a transcrição automática ligada, o resumo de uma ligação sem fala espera a transcrição da gravação para avisar o dono e classificar o desfecho, e é a transcrição que o pede de novo no fim. Se a transcrição falhava em todas as tentativas da fila, esse pedido não saía, e a ligação terminava sem aviso nenhum. Agora, na última tentativa, o resumo vai para a fila mesmo sem o texto: o aviso ao dono e o desfecho saem como sairiam sem a transcrição. Nas tentativas anteriores nada muda, porque a próxima pode dar certo. Nada muda para quem não ligou a transcrição automática, que vem desligada de fábrica. Crédito: @melgarafael.

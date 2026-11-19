---
impact: nothing_changes
section: fixed
title: O agente de atualização volta a passar a cada minuto logo depois de reiniciar a máquina
---

Em máquina cujo relógio de hardware guarda a hora local, e não a universal, o sistema sobe horas adiantado e o acerto de hora volta o relógio logo depois. O timer do agente, que contava pela hora do calendário, ficava marcado para horas depois. Nesse tempo, o painel não ouvia o agente, a atualização pela tela não andava e a checagem de saúde avisava "não fala com o painel desde". Agora o timer conta o tempo decorrido, que não pula. A primeira passada vem um minuto depois de o timer ligar, e as seguintes, um minuto depois do começo da anterior, com o mesmo atraso aleatório de até 15 segundos. Quando a atualização roda com permissão de administrador (a pasta é do root, ou o dono tem sudo sem senha), ela regrava o timer sozinha; senão, a saída da atualização avisa e diz o comando: `sudo bash install/agent.sh --install`. Sem esse comando, nada quebra: o timer antigo continua, com o defeito de depois do reboot. Crédito: @melgarafael.

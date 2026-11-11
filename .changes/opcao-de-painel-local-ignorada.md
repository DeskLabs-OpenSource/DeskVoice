---
impact: nothing_changes
section: fixed
title: A opção de painel só local era ignorada com as portas 80 e 443 livres
---

Numa VPS sem domínio e com as portas 80 e 443 livres, `DESKVOICE_PANEL_LOCAL_ONLY` era ignorada em silêncio: o painel ia para a internet na porta 80 e o instalador anunciava o endereço pelo IP, como se nada tivesse sido pedido. Agora a opção vale em todo modo. O valor é conferido antes de qualquer arquivo ser gravado e o único aceito é `yes` (`1`, `true` ou `sim` param a instalação dizendo o valor certo), e uma opção que não tem efeito no modo da sua máquina, como pedir painel só local numa instalação com domínio, para a instalação com um erro que nomeia a opção e o modo, em vez de seguir calada. O endereço mostrado no fim passa a ser lido do mesmo arquivo que publica a porta. Nada a fazer em instalações existentes. Crédito: @melgarafael.

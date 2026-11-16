---
impact: new_capability
section: added
title: A tela da linha mostra de quais endereços a central vai aceitar a ligação dela
---

Cada linha telefônica passa a mostrar "Vai aceitar ligações de: …", com os endereços de onde a
central vai aceitar a ligação daquela operadora quando o filtro de entrada for ligado: na linha por
IP, o endereço do servidor e os endereços extras; na linha por registro, o IP do servidor ou, quando
ele é um nome, os endereços para os quais o nome resolve (com a hora da última atualização). O
processo de voz recalcula a lista a cada vez que as linhas são aplicadas e de 5 em 5 minutos; se o
nome deixar de resolver, a lista fica como estava e a linha pede atenção com o motivo. O campo de
endereços extras aparece também na linha por registro, para a operadora que registra por um servidor
e entrega a ligação por outro: na linha por registro ele só vai valer para a entrada, e a linha continua
reconhecida pelo registro. Nada muda no que a central aceita: hoje ela ainda aceita ligações de
qualquer endereço, e a tela diz isso; a lista é o que um filtro futuro vai liberar, mostrada antes
de ele existir. Crédito: @melgarafael.

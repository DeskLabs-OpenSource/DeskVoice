---
impact: nothing_changes
section: fixed
title: No menu por teclas, a tecla apertada logo depois de uma tecla inválida não se perde mais
---

Quando quem liga apertava uma tecla inválida e logo outra, a segunda podia chegar enquanto o menu ainda registrava a tentativa anterior, e então era ignorada sem fala nem registro: quem liga ouvia o anúncio de novo e precisava apertar outra vez. Agora o menu segura essa tecla na memória da própria ligação, por esses instantes, e a lê na tentativa seguinte, na ordem em que chegou. A tecla segurada continua fora do banco, dos eventos e do log, como toda tecla de quem liga. Quem já instalou não precisa fazer nada. Crédito: @melgarafael.

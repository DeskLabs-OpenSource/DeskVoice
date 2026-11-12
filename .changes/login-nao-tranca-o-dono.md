---
impact: nothing_changes
section: fixed
title: Errar a senha de alguém não tranca mais essa pessoa fora do painel
---

Antes, cinco senhas erradas para um e-mail bloqueavam esse e-mail por 15 minutos, de qualquer lugar: quem soubesse o e-mail do dono o trancava fora, quantas vezes quisesse. Agora o bloqueio conta pelo e-mail junto com o endereço de onde a tentativa veio: cinco erros em 15 minutos bloqueiam só aquele endereço para aquele e-mail, e o dono, entrando de outro lugar, entra. Um mesmo endereço pode errar até 20 vezes em 15 minutos somando todas as contas, e um mesmo e-mail aceita até 50 erros por hora somando todos os endereços; passou disso, o painel pede para esperar. Quem entra por túnel SSH chega ao painel com o mesmo endereço que todo mundo, e para essa pessoa o bloqueio continua valendo por e-mail. O limite segue na memória do painel: reiniciá-lo zera a contagem. Nada a fazer em instalações existentes. Crédito: @melgarafael.

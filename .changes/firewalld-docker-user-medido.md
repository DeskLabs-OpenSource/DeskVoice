---
impact: nothing_changes
section: changed
title: O aviso do instalador sobre o firewalld diz o que foi medido com a regra do DOCKER-USER
---

Com o `firewalld` ativo, o instalador já avisava que ele não filtra as portas publicadas pelo Docker, e dizia que a regra na cadeia `DOCKER-USER` tinha sido medida só com o `ufw`. Agora ela foi medida também com o `firewalld`, numa VPS AlmaLinux: fecha a porta TCP, mas some ao reiniciar a máquina e deixa a porta aberta por alguns segundos a cada `firewall-cmd --reload`. O aviso passa a dizer isso, e a medida está em `docs/fundacao/ufw-e-docker.md`. Nada muda numa instalação. Crédito: @melgarafael.

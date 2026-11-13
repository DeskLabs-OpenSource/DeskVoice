---
impact: nothing_changes
section: changed
title: O instalador diz o que o firewalld faz com as portas do Docker
---

Com o `firewalld` ativo (AlmaLinux e Rocky Linux), o instalador avisava que esse caso não tinha sido provado e mandava começar pelo `firewalld` o diagnóstico de uma ligação muda. Agora está medido: o `firewalld` não filtra as portas que o Docker publica. A porta SIP e a faixa de áudio chegam aos contêineres com ele ligado, e nem uma regra de bloqueio dele as fecha. O aviso passa a dizer isso e aponta os dois lugares que de fato fecham a porta: o firewall do provedor da VPS, quando ele existe, e uma regra na cadeia `DOCKER-USER` da própria máquina. Nada a fazer em instalações existentes. Crédito: @melgarafael.

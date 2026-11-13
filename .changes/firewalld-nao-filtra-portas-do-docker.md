---
impact: nothing_changes
section: changed
title: O instalador diz o que o firewalld faz com as portas do Docker
---

Com o `firewalld` ativo (AlmaLinux e Rocky Linux), o instalador avisava que esse caso não tinha sido provado e mandava começar pelo `firewalld` o diagnóstico de uma ligação muda. Agora está medido: o `firewalld` não filtra as portas que o Docker publica. A porta SIP e a faixa de áudio chegam aos contêineres com ele ligado, e nem uma regra de bloqueio dele as fecha. O aviso passa a dizer isso e aponta o firewall do provedor da VPS, quando ele existe, como o lugar de fechar a porta. A regra na cadeia `DOCKER-USER`, que fecha a porta com o `ufw`, ainda não foi medida com o `firewalld`. Nada a fazer em instalações existentes. Crédito: @melgarafael.

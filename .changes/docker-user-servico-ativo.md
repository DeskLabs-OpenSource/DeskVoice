---
impact: nothing_changes
section: fixed
title: A regra do DOCKER-USER passa a valer também ao reiniciar o Docker logo depois do apply
---

O `bash install/docker-user.sh apply <portas>` agora deixa o serviço `deskvoice-docker-user` ligado e já ativo, e não só ligado para o próximo boot: assim, se o Docker for reiniciado antes de a máquina reiniciar, o serviço é chamado e confere a regra. O `apply` sem portas agora para o serviço antes de apagá-lo, e ele não fica na memória do systemd com o arquivo apagado. O texto do script e da documentação deixa de dizer que reiniciar o Docker esvazia a cadeia: o boot esvazia, e o reinício do Docker depende da versão dele (o 29.9.3 não esvaziou, medido). Quem já tem o serviço não precisa fazer nada: vale no próximo `apply`. Crédito: @webtecnica.

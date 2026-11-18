---
impact: new_capability
section: added
title: A regra do DOCKER-USER que fecha uma porta publicada pelo Docker sobrevive ao reinício
---

Nada muda numa instalação em funcionamento: nada é fechado sem ser pedido. A cadeia `DOCKER-USER` é a única que fecha uma porta publicada pelo Docker — nem o `ufw` nem o `firewalld` filtram essas portas —, e a regra escrita à mão sumia ao reiniciar a máquina, porque o Docker recria as cadeias dele vazias. O `install/docker-user.sh` escreve essa regra e deixa um serviço do systemd (`deskvoice-docker-user.service`, `After=docker.service`, `PartOf=docker.service`) que a repõe no boot e a cada reinício do Docker; rodar de novo não duplica regra, e a porta que sai da lista é reaberta. O instalador chama o script quando recebe `DESKVOICE_DOCKER_USER_DROP` (`5060/udp`, `10000:10200/udp`), e a mensagem do `firewalld` passa a apontar para ele. A janela de alguns segundos depois de `firewall-cmd --reload` continua: ela é do Docker refazendo as cadeias, não da regra. IPv6 segue sem medição e fora do script. Crédito: @webtecnica.

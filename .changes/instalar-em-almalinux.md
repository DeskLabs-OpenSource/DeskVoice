---
impact: new_capability
section: added
title: O instalador aceita AlmaLinux 9 e Rocky Linux 9
---

Além de Ubuntu 22.04+ e Debian 12+, o instalador passa a aceitar AlmaLinux 9+ e Rocky Linux 9+
sem `--force`, e as mensagens dele mostram a lista inteira. Quando o Docker está instalado e com o
serviço desligado, como veio numa VPS AlmaLinux da parceira, o instalador liga o serviço
(`systemctl enable --now docker`) e diz isso na tela. Sem `git`, o comando de uma linha o instala
pelo `dnf` quando não há `apt-get`. Com o `firewalld` ativo, ou com o SELinux em `Enforcing` e o
Docker rodando com ele ligado, o instalador avisa que esse caminho não foi provado e segue. O
AlmaLinux 9 foi instalado numa VPS em 12/11/2026 com o serviço do Docker ligado à mão; a ligação
automática ainda não rodou numa máquina real, e o Rocky Linux 9 não foi provado. Nada a fazer em
instalações existentes. Crédito: @melgarafael.

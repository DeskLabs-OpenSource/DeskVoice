---
impact: nothing_changes
section: fixed
title: O log do Asterisk deixa de crescer sem limite e de encher o disco
---

O Asterisk gravava um arquivo de log dentro do contêiner, o `/var/log/asterisk/messages.log`, sem limite e sem rotação. Numa instalação ele passou de 20 GB em duas semanas e quase encheu o disco. Agora o Asterisk escreve o log só na saída do contêiner, que o Docker já limita (10 MB por arquivo, cinco arquivos), e o que ele diz continua em `docker compose -f deploy/docker-compose.yml logs asterisk`. Quem já instalou não precisa fazer nada: a atualização normal aplica o limite, e para isso recria o contêiner do Asterisk uma vez (as ligações em andamento naquele momento caem). O arquivo que já existe não é apagado, porque a atualização não apaga dado sem pedir. A checagem de saúde (`bash install/healthcheck.sh`) ganhou a linha "Log do Asterisk": passando de 1 GB, ela vira aviso e traz o comando que esvazia o arquivo antigo, para quem quiser liberar o espaço. Crédito: @melgarafael.

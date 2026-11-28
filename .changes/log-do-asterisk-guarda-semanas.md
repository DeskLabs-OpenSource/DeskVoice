---
impact: nothing_changes
section: changed
title: O log do Asterisk passa a guardar semanas, e não cerca de um dia
---

O `docker compose -f deploy/docker-compose.yml logs asterisk` guardava cerca de um dia: os avisos
NOTICE do Asterisk eram quase todo o volume e enchiam o teto do log. Eles saem desse log; ficam a
partida do Asterisk, o caminho de cada ligação, os avisos (WARNING) e os erros (ERROR). Com isso o
log guarda cerca de sete semanas (medido sem ligações); cada ligação soma, e com muito movimento
cabe menos. A linha "Log do Asterisk" de `bash install/healthcheck.sh` diz desde quando o log da
sua instalação guarda. Para guardar mais tempo, copie o log para um arquivo antes
(`docker compose -f deploy/docker-compose.yml logs -t asterisk > asterisk.log`), ou dê ao serviço
`asterisk` do `deploy/docker-compose.yml` um `logging` próprio, com `max-size` e `max-file`
maiores, sabendo que a atualização sobrescreve esse arquivo. Nada a fazer além de atualizar: a configuração nova do log
entra sem reiniciar o Asterisk e sem derrubar ligação. Crédito: @melgarafael.

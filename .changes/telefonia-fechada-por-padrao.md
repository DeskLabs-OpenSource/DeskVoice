---
impact: operator_action
section: changed
title: Instalação nova nasce com o SIP fechado para a internet
---

O `asterisk` publicava `5060/udp` e a faixa de RTP em `0.0.0.0` em qualquer instalação, com ou sem tronco cadastrado, e "porta fechada no firewall" não é a mesma coisa que porta fechada: o Docker entra por DNAT/FORWARD e o UFW não filtra container, então uma central sem nenhuma linha configurada respondia a quem a encontrasse na internet — verificado numa instalação real, com o `ufw status` listando apenas 22, 80 e 443. Agora as duas publicações obedecem a `SIP_BIND`: o instalador grava `127.0.0.1` em instalação nova, e a central só é alcançável de fora quando a instalação declara `0.0.0.0`. Quem já está instalado não muda de comportamento, porque o padrão do Compose continua `0.0.0.0` e a escolha gravada é preservada. Crédito: @webtecnica.

## Requer atenção

Quem usa tronco SIP de operadora precisa definir `DESKVOICE_SIP_BIND=0.0.0.0` no arquivo de respostas ou `SIP_BIND=0.0.0.0` no `deploy/.env` antes de atualizar. Sem isso, a operadora não alcança a central e a ligação não entra — sem erro no painel, o sintoma é só a chamada que não chega. Instalação que não tem tronco não precisa fazer nada.

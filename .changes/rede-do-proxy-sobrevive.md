---
impact: nothing_changes
section: fixed
title: O painel atrás do Caddy do CRM não cai mais a cada atualização
---

Quem publica o DeskVoice pelo Caddy do DeskcommCRM na mesma VPS ligava o Caddy do DeskVoice na rede do CRM à mão, com `docker network connect`. Cada atualização recriava o contêiner, a ligação se perdia, e o domínio respondia 502 até alguém refazer o passo. Agora o instalador grava essa rede no arquivo de publicação que ele mesmo gera, com `DESKVOICE_PROXY_NETWORK=<rede> bash install/install.sh`, e o contêiner recriado já nasce nela, com o nome `deskvoice`. Se a rede não existe, a instalação e a atualização param antes de mudar qualquer coisa. `DESKVOICE_PROXY_NETWORK=off` tira a rede. Nada muda para quem não usa o CRM na mesma VPS. Quem fez a ligação à mão roda o passo 3 do guia uma vez e não precisa mais repeti-lo. Crédito: @melgarafael.

---
impact: nothing_changes
section: fixed
title: A restauração confere a rede do proxy do CRM antes de trocar o banco
---

Numa instalação publicada pelo Caddy do DeskcommCRM, com a rede dele gravada pelo instalador (`DESKVOICE_PROXY_NETWORK`), a restauração de um backup agora confere, antes de parar qualquer serviço, se essa rede ainda existe. Se ela sumiu, os serviços não voltariam a subir depois da troca do banco. Por isso a restauração para sem mexer em nada e diz como seguir, do mesmo jeito que a instalação e a atualização já faziam. Nada muda para quem não usa o CRM na mesma VPS. Crédito: @melgarafael.

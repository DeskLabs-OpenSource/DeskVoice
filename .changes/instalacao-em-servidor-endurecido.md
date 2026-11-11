---
impact: operator_action
section: fixed
title: Instalação em servidor com permissões restritivas passa a atender ligação
---

Num servidor com permissões restritivas (umask 077), o Asterisk subia sem conseguir ler o plano de discagem e a interface de controle: a instalação terminava dizendo que estava tudo certo e nenhuma ligação seria atendida. O instalador agora grava tudo o que o Asterisk lê com a permissão correta, e a checagem de saúde ganhou a linha "Controle da telefonia", que falha quando o processo de voz não consegue falar com o Asterisk. Também dá para deixar o painel acessível só de dentro da VPS, por túnel SSH, quando não há domínio. Achado na primeira instalação real, numa VPS da HostGator. Crédito: @melgarafael

## Requer atenção

Quem já instalou precisa rodar `bash install/install.sh` de novo depois de atualizar: é ele que regrava os arquivos do Asterisk no lugar novo. Confira depois com `bash install/healthcheck.sh` que "Controle da telefonia" aparece como ok.

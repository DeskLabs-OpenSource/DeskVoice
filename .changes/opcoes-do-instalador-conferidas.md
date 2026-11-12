---
impact: nothing_changes
section: fixed
title: O instalador recusa as opções de firewall e de versão que antes passavam caladas
---

`DESKVOICE_APPLY_UFW` com qualquer valor diferente de `yes` era ignorada sem aviso, e a regra de firewall não aplicada deixa a ligação muda. Agora o instalador para antes de gravar qualquer coisa e diz o valor aceito, e diz quando a opção não tem efeito porque o `ufw` não está ativo. Com `DESKVOICE_APPLY_UFW=yes`, o instalador rodado com perguntas também passa a aplicar as regras sem perguntar; antes a opção só valia junto de `--yes`, e sem ele a pergunta aparecia mesmo assim. `DESKVOICE_VERSION` junto de `--build` também para com erro, nomeando as duas, em vez de ignorar a versão pedida e construir o código da pasta. Crédito: @melgarafael.

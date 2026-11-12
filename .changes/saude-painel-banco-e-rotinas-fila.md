---
impact: nothing_changes
section: fixed
title: A checagem de saúde do terminal mostra se o painel chega ao banco e se as rotinas consomem a fila
---

`bash install/healthcheck.sh` ganhou duas linhas, lidas da mesma conferência que a tela "Saúde do sistema" faz. "Painel → banco" diz se o painel entra no banco, e não só se o banco está de pé; é peça essencial, então uma atualização em que o painel não consegue entrar no banco volta sozinha. "Rotinas → fila" diz se o processo de rotinas está conectado esperando tarefas e se a fila anda; antes, rotinas que perdiam a conexão apareciam como "ok". Ela é falha não essencial e não provoca a volta de uma atualização: as ligações seguem atendidas, e resumos e avisos esperam na fila até as rotinas voltarem. Crédito: @melgarafael.

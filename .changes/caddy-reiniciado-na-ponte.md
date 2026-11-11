---
impact: nothing_changes
section: fixed
title: Quem veio da 0.1.0 ficava com o Caddy rodando a configuração antiga
---

Em quem atualizou da 0.1.0 para a 0.2.0 rodando `bash install/update.sh` duas vezes, o Caddy continuava com a configuração da 0.1.0, porque o arquivo só é relido quando o Caddy reinicia e o atualizador da 0.1.0 não o reiniciava. A rota do agente de atualização seguia recusada para quem vinha de fora, mas quem recusava era o painel, e não o Caddy, que é a camada que deveria escondê-la. Agora o `update.sh`, quando não há versão nova a instalar, compara o arquivo que o Caddy tem montado com o do disco e o reinicia se forem diferentes (o painel fica fora por alguns segundos, uma vez só). A checagem de saúde também passou a ver isso: a linha "Agente de atualização" vira aviso e diz para reiniciar o Caddy. Quem atualizar desta versão em diante pelo terminal ou pela tela já tem o Caddy reiniciado na própria atualização; nada a fazer. Crédito: @melgarafael.

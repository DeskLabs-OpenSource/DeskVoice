---
impact: new_capability
section: added
title: A saída inteira de cada atualização fica guardada no servidor
---

O painel mostra só o fim da saída do atualizador. Agora o agente do servidor guarda a saída inteira de cada atualização em `deploy/agent/last-update.log`, na pasta do DeskVoice, com as mesmas senhas e e-mails escondidos que a tela esconde, e só o dono do arquivo o lê. Ficam as três últimas: a mais nova nesse arquivo e as duas anteriores em `last-update.log.1` e `last-update.log.2`. A tela, no resultado da atualização, aponta o arquivo. Quem executa uma atualização é o agente da versão que estava instalada, então a atualização que traz esta versão ainda não guarda o arquivo, e a tela não o aponta; as seguintes guardam. Crédito: @melgarafael.

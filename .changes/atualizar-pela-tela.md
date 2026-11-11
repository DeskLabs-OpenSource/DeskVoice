---
impact: new_capability
section: added
title: Atualizar pela tela
---

Em Configurações, o bloco "Versão e atualização" mostra a versão que o servidor está rodando, a mais recente publicada e o que muda entre as duas, com os avisos de "requer atenção" em destaque. O dono ou um administrador clica em atualizar, confirma com a senha, e o servidor faz o resto: backup, troca de versão, mudanças no banco e conferência; se a versão nova não responder, volta sozinho para a anterior, e a tela diz o que aconteceu e por quê. O sistema fica fora do ar por alguns minutos e as chamadas em andamento caem, como na atualização pelo terminal. Quem executa não é o painel: é um agente pequeno do kit de instalação, que passa a cada minuto no servidor e só lê do painel um sim ou um não. A consulta à versão mais recente é pública e não envia nada sobre a sua instalação. Quem já está na 0.1.0 faz esta atualização pelo terminal, como antes, porque a 0.1.0 não tem o agente; em seguida roda `bash install/update.sh` mais uma vez (não há o que atualizar: é o atualizador novo instalando o agente), e dali em diante atualiza pela tela. Enquanto o agente não estiver instalado, a própria tela avisa e mostra o comando. Instalação construída no próprio servidor (`--build`, ou em processador ARM) continua atualizando só pelo terminal. Crédito: @melgarafael.

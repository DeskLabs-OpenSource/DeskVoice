---
impact: nothing_changes
section: changed
title: O instalador só diz "pronto" depois de entrar no painel com o seu usuário
---

Depois de criar o usuário dono, o instalador confere que a porta publicada responde e faz login de verdade pela tela de entrada, com o e-mail e a senha que você acabou de definir, antes de mostrar o endereço. A senha não aparece na tela nem em lista de processos. Se a porta local não responde ou o login do usuário recém-criado é recusado, a instalação termina com erro dizendo o que falhou e o que fazer, em vez de dizer que está pronta; rodar de novo retoma de onde parou. Com domínio, se o que ainda não abre é o endereço de fora (o caso mais comum é o domínio ainda não apontar para a VPS), a instalação não falha: termina dizendo "Instalado; o endereço ainda não abre", com a causa provável e o que fazer, sem dar o endereço como certo. O comando do túnel SSH passa a vir com o seu usuário preenchido. Numa instalação que já tinha dono, sem a senha em mãos, ele diz que não testou o login. O `reset-password.sh` ganhou a mesma conferência: só diz que trocou depois de entrar com a senha nova, e avisa quando o painel ainda está segurando tentativas para aquele e-mail. O `update.sh` passa a conferir também a porta publicada no fim. Nada a fazer em instalações existentes. Crédito: @melgarafael.

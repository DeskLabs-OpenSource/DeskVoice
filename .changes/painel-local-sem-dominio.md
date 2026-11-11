---
impact: new_capability
section: changed
title: Sem domínio, o painel deixa de ser publicado na internet sem HTTPS
---

Muda o padrão de instalação nova: sem domínio não há HTTPS, então o instalador passa a deixar o painel só dentro da VPS (em `127.0.0.1:3080`) e mostra no fim o comando do túnel SSH para abri-lo do seu computador, e como apontar um domínio para ter HTTPS. Antes, com a porta 80 livre, a tela de login ficava aberta na internet por HTTP, com a senha trafegando sem criptografia. Quem quer mesmo publicar pelo IP, para um teste, pede de propósito com `DESKVOICE_PANEL_PUBLIC_HTTP=yes` (ou responde "s" à pergunta do instalador, que diz o risco). **Quem já instalou não muda:** rodar o instalador ou o atualizador de novo mantém o painel como está, inclusive se ele já abre pelo IP; nesse caso o instalador avisa em destaque e mostra o comando para fechar, `DESKVOICE_PANEL_LOCAL_ONLY=yes bash install/install.sh`, que agora funciona também com as portas 80 e 443 livres. A decisão do padrão está registrada em `docs/decisions/0011` e aguarda a revisão do dono do projeto. Crédito: @melgarafael.

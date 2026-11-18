---
impact: nothing_changes
section: fixed
title: A checagem de saúde deixa de dizer que está tudo certo com o login do painel quebrado
---

A checagem de saúde passou a pedir o login de verdade, com uma credencial que não existe, e
recusa dizer que está tudo bem quando a rota responde erro de servidor: uma volta de versão que
quebrou a entrada do painel agora acusa na hora e provoca a volta da atualização, em vez de
terminar "com todas as peças essenciais respondendo". Nada a configurar. Crédito: @webtecnica.

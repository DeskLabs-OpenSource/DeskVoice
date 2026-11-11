---
impact: new_capability
section: changed
title: A instalação passa a gravar o número da versão, e não constrói mais imagem na VPS depois da primeira versão publicada
---

O instalador agora descobre a versão publicada mais recente, baixa as imagens dela e grava o número em vez de "stable": você sabe o que está rodando (`bash install/diagnose.sh` mostra), e duas instalações com o mesmo número rodam as mesmas imagens. Se as imagens de uma versão publicada não baixam, o instalador e o `update.sh` param com a resposta do Docker e o comando para testar, sem alterar nada, em vez de construir na sua VPS; construir ali só acontece enquanto o projeto não tiver nenhuma versão publicada, ou a pedido de quem desenvolve, com `bash install/install.sh --build`. O banco e o Caddy passaram a ser baixados numa versão exata, a mesma em toda instalação. Nada a fazer em instalações existentes: uma instalação antiga, com "stable" gravado, passa para o número na próxima vez que você rodar `bash install/update.sh` ou o instalador, sem mexer nos dados. Crédito: @melgarafael

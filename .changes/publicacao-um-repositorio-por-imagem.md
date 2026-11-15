---
impact: nothing_changes
section: fixed
title: A 0.12.0 não chegou a ser publicada, e a 0.12.1 é a primeira com as imagens e o ARM
---

A publicação da 0.12.0 parou antes de etiquetar as imagens, por dois defeitos no workflow novo, que publica uma imagem por arquitetura. A voz e as rotinas eram enviadas para o repositório da imagem do painel, e o passo que guarda o resumo de cada imagem parava num erro de shell. A tag `v0.12.0` existe, mas não tem release nem imagens, e uma instalação ou atualização para ela para antes de mexer em qualquer coisa, dizendo que não conseguiu baixar as imagens. A 0.12.1 traz tudo o que a 0.12.0 anunciava, sem nenhuma mudança além deste conserto. Quem tentou atualizar para a 0.12.0 roda a atualização de novo. Crédito: @melgarafael.

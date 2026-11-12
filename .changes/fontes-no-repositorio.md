---
impact: nothing_changes
section: changed
title: As fontes do painel vêm junto com o código, e a construção da imagem não depende do serviço de fontes do Google
---

O painel usa as mesmas duas fontes de antes (Atkinson Hyperlegible e IBM Plex Mono), mas os arquivos agora estão no repositório, com a licença de cada uma. Antes, a construção da imagem do painel baixava as fontes na hora; sem acesso a esse serviço, a construção parava, inclusive a construção local num servidor ARM. Nada muda para quem já instalou. Crédito: @melgarafael.

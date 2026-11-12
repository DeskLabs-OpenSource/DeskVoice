---
impact: nothing_changes
section: fixed
title: Mais três faixas de endereço interno passam a ser recusadas na checagem de destino
---

A checagem de destino do `safeFetch` (o `fetch` de endereço vindo de configuração, usado por webhooks e conectores) ganhou as três faixas que faltavam depois da correção anterior: o IPv4 traduzido (`::ffff:0:a.b.c.d`), que embute IPv4 do mesmo jeito que as já recusadas, o site-local antigo (`fec0::/10`) e o prefixo de descarte (`100::/64`). O risco prático era baixo, porque dependia de a rede da VPS traduzir ou rotear essas faixas, mas a lista existe para não depender disso. Endereço público continua aceito; nada a configurar em instalações existentes. Achado na revisão da contribuição de @webtecnica. Crédito: @melgarafael.

---
impact: nothing_changes
section: fixed
title: Endereço que embute IPv4 e passava pela checagem de destino agora é recusado
---

A checagem de destino do `safeFetch` (o `fetch` de endereço vindo de configuração) já recusava IPv4 embutido em IPv6 e a faixa global do NAT64, mas deixava passar três faixas que embutem IPv4 do mesmo jeito: a faixa de uso local do NAT64, o 6to4 e o Teredo. Numa rede IPv6-only com NAT64 de uso local, um endereço como `64:ff9b:1::a00:1` chegava no `10.0.0.1` interno, que é exatamente o que a lista existe para impedir. Agora as três são recusadas como qualquer destino interno, e endereço público de verdade continua aceito — nada a configurar em instalações existentes. Crédito: @webtecnica.

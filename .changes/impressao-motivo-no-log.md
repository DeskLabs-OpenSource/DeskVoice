---
impact: nothing_changes
section: fixed
title: A falha no cálculo da impressão digital vai para o log, e o tamanho da gravação não depende mais de uma leitura do disco
---

Quando a impressão digital de uma gravação não pode ser calculada, o motivo agora fica no log do processo de voz, tanto na ligação quanto no recado da caixa postal. Antes, a falha era descartada em silêncio. O tamanho da gravação, que aparece na linha do tempo, passa a vir do próprio cabeçalho do arquivo, e não de uma segunda leitura do disco, que também podia falhar depois de a gravação estar salva. Crédito: @melgarafael.

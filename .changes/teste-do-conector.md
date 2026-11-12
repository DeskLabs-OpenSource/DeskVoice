---
impact: nothing_changes
section: fixed
title: A mensagem de teste passou a provar o conector configurado, não só o QR Code
---

Quem configurava um conector de endereço do operador (DeskcommCRM ou webhook) não tinha como saber se
ele funcionava antes da primeira ligação real: o botão de teste mandava a mensagem pelo número
conectado por QR Code, e sem número conectado o botão nem aparecia na tela. Agora o teste sai pelo
conector configurado, pelo mesmo caminho do aviso de ligação, e quando o destino recusa a tela diz
que foi o conector — em vez de um erro sem nome. Nada a fazer em instalações existentes: o número
conectado por QR Code continua sendo testado como antes. Crédito: @webtecnica.

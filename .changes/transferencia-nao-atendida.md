---
impact: new_capability
section: fixed
title: Transferência que ninguém atende não passa mais por atendida
---

Quando o destino da transferência não atende, está ocupado ou cai, a chamada terminava como se a
transferência tivesse dado certo, e quem opera só descobria pelo cliente. Agora a equipe recebe, no
painel, um aviso com quem ligou, por que pediu para falar com uma pessoa e o resumo do que já tinha
sido combinado, com o pedido de retornar a ligação. Na linha do tempo da chamada, o fim da
transferência aparece como "Transferência não atendida", e não mais como "Transferência concluída".
Na lista de chamadas ela continua como "Transferida"; o motivo `transfer_unanswered` sai pela API e
na exportação. Se quem ligou desligou enquanto a transferência tocava, o aviso sai igual, e o motivo
continua `transferred`. A transferência atendida não gera aviso, seja quem for que desligue depois.
As transferências atendidas gravadas antes desta versão ficaram registradas como não atendidas e passam a aparecer como "Transferência não atendida" na linha do tempo; as novas aparecem certas.
Crédito: @webtecnica.

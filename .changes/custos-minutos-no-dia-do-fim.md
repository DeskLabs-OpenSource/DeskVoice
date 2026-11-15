---
impact: nothing_changes
section: fixed
title: Em Custos, a duração de uma ligação conta só no dia em que ela terminou
---

Os minutos de cada motor, no quadro "Por motor" da tela de Custos, contavam a ligação inteira em todo período em que ela tinha alguma linha no extrato. Com o desfecho classificado depois da meia-noite, a mesma ligação aparecia inteira em dois dias. Agora ela conta no dia em que terminou, no fuso da organização, como o resto do quadro. Na API de custos (`/api/v1/system/costs`), os dois campos que se chamavam `seconds` passaram a ter nomes que dizem o que medem: `byDay[].billedSeconds` é o uso declarado pelos motores para cobrar, e `byEngine[].callSeconds` é a duração das ligações. A tela já usa os nomes novos. Crédito: @melgarafael.

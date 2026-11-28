---
impact: nothing_changes
section: fixed
title: Configurações → Integrações — duas gravações de servidor MCP ao mesmo tempo não se perdem mais
---

Em Configurações → Integrações, dois cadastros de servidor MCP feitos ao mesmo tempo na mesma organização podiam se atropelar: com o mesmo identificador, o segundo sobrescrevia o primeiro em vez de receber o aviso de que ele já existe; com identificadores diferentes, um dos dois sumia sem aviso. Agora as gravações dos servidores MCP de uma organização entram uma de cada vez: com o mesmo identificador, o segundo pedido recebe o aviso de servidor já cadastrado, e com identificadores diferentes os dois ficam gravados. O mesmo vale para descadastrar um servidor enquanto outro é gravado. Nada a configurar. Contexto: a observação do Verificador 2 no #563. Crédito: @melgarafael.

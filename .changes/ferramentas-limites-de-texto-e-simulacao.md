---
impact: nothing_changes
section: changed
title: As ferramentas do agente ganham limite de tamanho nos textos, e na ligação simulada o aviso e o pedido de aprovação à equipe não saem pelo WhatsApp
---

O aviso à equipe (até 1000 caracteres), a pergunta de aprovação (até 300) e o contexto dela (até 1000), os detalhes de uma pendência (até 2000) e o motivo de uma transferência (até 300) passam a ter tamanho máximo. Texto maior é recusado, nunca cortado: o agente ouve o limite e escreve de novo, mais curto. Na ligação simulada, o aviso e o pedido de aprovação continuam aparecendo no painel, mas não saem mais pelo WhatsApp da equipe, e a linha do tempo da ligação diz que o WhatsApp teria recebido. Na integração chamada pelo agente, o nome que não existe recebe só a resposta de que ele não existe, e o campo `callId` enviado é sempre o da ligação. Quem já instalou não precisa fazer nada. Crédito: @melgarafael.

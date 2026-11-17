---
impact: nothing_changes
section: changed
title: As escolhas de pessoa da organização consideram só quem é da equipe
---

Preparação interna para o acesso de suporte da administração da instalação, que ainda não existe. Toda consulta que escolhe, conta ou lista pessoas da organização para agir ou avisar passa a considerar só quem é da equipe: o resumo da ligação e os avisos pelo WhatsApp, os números que o agente aceita como "da equipe" no `send_whatsapp`, a escolha do responsável da pendência (na tela, no agente e no lembrete), a contagem de donos e a lista da tela Equipe. Hoje todo vínculo é da equipe, então nenhuma lista, aviso ou escolha muda para ninguém, e a atualização não mexe no banco. Uma verificação nova no CI reprova a consulta nova que lê as pessoas da organização sem esse filtro, a menos que ela esteja numa lista curta de exceções, cada uma com o motivo (mostrar o nome de quem agiu, ler a própria sessão). Crédito: @melgarafael.

---
impact: new_capability
section: added
title: O conector DeskcommCRM manda a mensagem pelo próprio CRM, pelo canal escolhido
---

Em Configurações → WhatsApp → Avançado, o conector DeskcommCRM ganha o modo "Pelo contrato do CRM": você informa o endereço do CRM e um token dele, e as mensagens e os avisos saem pela rota de mensagens do CRM. O botão "Conferir o CRM" testa o token na porta do MCP e na REST, só lendo, avisa quando o token é só-MCP (a REST o recusa, e a mensagem não sairia) e lista os canais de mensagem do CRM, para escolher por onde a mensagem sai; sem canal escolhido, o CRM decide pela regra dele. Na tela do agente, a opção "Quando a ligação cai" passa a dizer o canal do CRM. Quem já instalou não vê diferença: um conector DeskcommCRM gravado antes fica no modo "Por um endereço próprio (formato antigo)" e continua mandando para o endereço que foi digitado, e passar ao modo novo pede o token de novo. Crédito: @edgariamaguti.

---
impact: new_capability
section: added
title: A classificação do desfecho aceita um provedor compatível com OpenAI
---

Quem paga um provedor compatível com OpenAI, como DeepSeek, Qwen, OpenRouter ou Groq, agora classifica o desfecho das ligações nele: em Configurações, Inteligência artificial, o motor OpenAI ganhou os campos de endpoint, chave e modelo da classificação. O endpoint compatível tem chave própria, guardada cifrada: a chave do motor nunca vai a ele, e trocar o endpoint pede a chave de novo. Endpoint sem a chave dele não recebe nada, e a linha do tempo da ligação diz por quê. O destino passa pela mesma guarda de rede dos conectores. Em branco, nada muda: o pedido continua indo à OpenAI com o modelo e a chave de sempre. A voz em tempo real segue no endpoint oficial do motor, e o custo de um modelo configurado não é estimado: o consumo em tokens aparece no extrato e o custo fica zero até o preço dele ser medido. Crédito: @webtecnica.

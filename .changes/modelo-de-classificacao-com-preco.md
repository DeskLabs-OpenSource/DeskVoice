---
impact: operator_action
section: changed
title: Modelo da classificação sem endpoint só vale com preço conhecido
---

O modelo da classificação gravado sem endpoint faz o pedido ir ao provedor do motor, que cobra por ele, e o custo só é medido quando o projeto conhece o preço do modelo. Agora o painel recusa salvar um modelo sem endpoint que não esteja na tabela de preço, com a mensagem que pede o endpoint, e a classificação de quem já tinha esse modelo gravado volta a usar o modelo do motor, que tem preço medido — o consumo em tokens continua no extrato. Com endpoint configurado, nada muda: o preço é do provedor do endpoint e o modelo é o que o dono escolheu. Crédito: @webtecnica.

## Requer atenção

Se a sua instalação tem um modelo da classificação salvo sem endpoint, abra Configurações, Inteligência artificial, e informe também o endpoint do provedor e a chave dele — ou apague o modelo e salve. Sem isso, a classificação passa a usar o modelo do motor.

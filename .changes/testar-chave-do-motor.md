---
impact: new_capability
section: added
title: A chave do motor de voz pode ser testada antes da primeira ligação
---

Em Configurações → Motores de voz, cada chave do Gemini ou da OpenAI ganhou o botão Testar a chave, só para dono e administrador, e salvar uma chave nova já a testa e diz o resultado, sem impedir de salvar. O teste não abre sessão de voz e não gasta: ele lê, na API do provedor, os dados do modelo que o motor usa. A resposta diz o que falta: chave recusada, chave sem acesso ao modelo, falta de crédito ou teto de gasto, provedor que não atende o país do servidor, limite de pedidos do provedor, provedor sem resposta, ou resposta que o DeskVoice não reconhece. O resultado fica guardado ("testada em ...: aceita", ou o problema), e a linha Motor de voz da tela de saúde e do `install/healthcheck.sh` passa a acusar a chave recusada como falha, com o que fazer; a checagem de saúde nunca testa por conta própria. Na tela de saúde, cada pessoa vê só a chave da própria organização; o `install/healthcheck.sh`, que não entra no painel, diz só que um teste não deu certo e manda ver em Configurações. O botão tem limite de cinco testes por motor a cada dez minutos. Nada a fazer em instalações existentes: a chave que já está salva aparece como ainda não testada até alguém clicar. Crédito: @melgarafael.

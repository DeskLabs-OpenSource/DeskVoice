---
impact: nothing_changes
section: fixed
title: O agente configurado como en-US ou es-MX fala inglês ou espanhol também na passagem e na agenda
---

Com o idioma do agente escrito com região (`en-US`, `es-MX`), a saudação da passagem entre agentes e as falas das ferramentas de agenda saíam em português, porque cada uma escolhia o idioma por um mapa de três valores e o que ficava fora dele caía no pt-BR. Agora as duas leem o idioma pelo prefixo, num único lugar: `en-US` fala inglês, `es-MX` fala espanhol, e `pt-BR`, `en` e `es` continuam exatamente como eram. Idioma que as falas não têm, campo vazio ou texto qualquer seguem no português, sem erro. O aviso da caixa postal continua no idioma escolhido em Configurações › Chamadas, sem mudança. Nada a configurar em instalações existentes. Achado na revisão do #344. Crédito: @webtecnica.

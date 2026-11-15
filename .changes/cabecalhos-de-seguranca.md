---
impact: nothing_changes
section: fixed
title: O painel passa a enviar cabeçalhos de segurança
---

O painel respondia sem `X-Frame-Options`, sem CSP e sem `nosniff`, então qualquer página podia abri-lo dentro de um iframe invisível e colher o clique em botões que transferem chamada, apagam dado e disparam atualização. Agora toda resposta traz `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `base-uri` e `form-action` restritos ao próprio domínio, `nosniff`, política de referência, HSTS só para o endereço do painel (sem obrigar HTTPS nos outros subdomínios da empresa) e câmera e localização fechadas. O microfone continua liberado para o próprio painel, que o usa em "Falar com o agente". A CSP é curta de propósito: não mexe em `script-src` nem `style-src`, porque o Next injeta scripts inline e o painel abre WebSocket, e uma política que quebra a tela acaba sendo desligada por quem opera.
Crédito: @webtecnica.

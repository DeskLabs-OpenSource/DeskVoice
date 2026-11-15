---
impact: nothing_changes
section: fixed
title: O painel passa a enviar cabeçalhos de segurança
---

O painel respondia sem `X-Frame-Options`, sem CSP e sem `nosniff`, então qualquer página podia abri-lo dentro de um iframe invisível e colher o clique em botões que transferem chamada, apagam dado e disparam atualização — e um `127.0.0.1:3080` alcançado por fora do Cloudflare não herdava nenhuma proteção do CDN; agora toda resposta traz `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `base-uri` e `form-action` restritos ao próprio domínio, `nosniff`, política de referência, HSTS e permissões fechadas para câmera, microfone e localização. A CSP é curta de propósito: não mexe em `script-src` nem `style-src`, porque o Next injeta scripts inline e o painel abre WebSocket, e uma política que quebra a tela acaba sendo desligada por quem opera — o que fecha o clickjacking e o sequestro de formulário é o que está lá.
Crédito: @webtecnica.

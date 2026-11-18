---
impact: new_capability
section: added
title: A checagem de saúde avisa quando a rede do proxy não está gravada
---

O `install/healthcheck.sh` ganhou a linha "Rede do proxy". Quando existe nesta máquina a rede de proxy de outro sistema (a `*_caddy-sites` de um CRM na mesma VPS) e ela não está gravada no arquivo de publicação, a linha avisa e traz o comando para gravá-la. É o caso de quem ligou o Caddy à rede à mão, antes da 0.11.0: essa ligação se perde quando o contêiner é recriado, e o domínio do painel passa a responder 502. A linha também avisa quando a rede gravada não existe mais. É só aviso: não muda o código de saída e não há nada a configurar em instalações que já têm a rede gravada. Crédito: @webtecnica.

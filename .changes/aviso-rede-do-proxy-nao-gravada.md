---
impact: new_capability
section: added
title: A checagem de saúde avisa quando a rede do proxy não está gravada
---

O `install/healthcheck.sh` ganhou a linha "Rede do proxy": quando existe nesta máquina a rede de proxy de outro sistema (a `*_caddy-sites` de um CRM na mesma VPS) e ela não está no arquivo de publicação, a checagem avisa em vez de deixar o problema aparecer só como um 502 no domínio — é o caso das instalações que fizeram a ligação à mão antes da 0.11.0, em que o Caddy recriado nasce fora da rede e o painel sai do ar em silêncio. Nada a configurar em instalações que já têm a rede gravada. Crédito: @webtecnica.

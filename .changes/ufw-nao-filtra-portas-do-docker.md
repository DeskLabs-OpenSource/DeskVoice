---
impact: nothing_changes
section: changed
title: O instalador não vende mais as regras de ufw como proteção
---

As portas de telefonia são publicadas pelo Docker, e o Docker passa por fora do `ufw`: as regras que o instalador oferecia não abriam nem fechavam nada. A mensagem do instalador passa a dizer isso, e a documentação aponta os dois lugares que de fato filtram a porta: o firewall do provedor da VPS, quando ele existe, e uma regra na cadeia `DOCKER-USER` da própria máquina. Nada a fazer em instalações existentes. Crédito: @webtecnica.

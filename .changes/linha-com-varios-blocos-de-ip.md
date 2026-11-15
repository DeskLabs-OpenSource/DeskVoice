---
impact: operator_action
section: added
title: Linha por IP aceita mais de um bloco de endereço e um destino de saída
---

Na tela da linha, em modo por IP, há dois campos novos: outros endereços de onde as ligações chegam (um por linha, IP ou bloco) e o endereço para as ligações de saída. Com eles, uma operadora que entrega a chamada por vários blocos, um por região, entra no cadastro sem perder ligação quando uma região cai, e a mesma linha recebe pelo endereço e liga pelo nome da conta. Os endereços de entrada são só numéricos: o nome do provedor é aceito apenas no endereço de saída. O reconhecimento por IP recusa bloco largo demais, mais que /16 no IPv4 ou /32 no IPv6. A linha que já existe, com um endereço só, não muda. Crédito: @webtecnica.

## Requer atenção

Uma linha por IP cujo endereço do servidor seja um bloco mais largo que /16 (IPv4) ou /32 (IPv6) passa a ficar de fora da configuração depois da atualização, e deixa de receber ligações. A tela da linha mostra a linha com falha e o motivo. Para voltar a receber, cadastre na tela da linha os blocos menores que a operadora publica, ou o IP dela.

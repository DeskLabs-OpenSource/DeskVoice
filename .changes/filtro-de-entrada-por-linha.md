---
impact: operator_action
section: changed
title: A central só aceita a ligação de uma linha que vem dos endereços dela
---

A central de telefonia passa a filtrar a entrada linha por linha: cada linha só aceita ligações
dos endereços que a tela mostra em "Aceita ligações de", e a ligação que se apresenta como aquela
linha vinda de qualquer outro endereço é recusada. Na linha por IP, valem o endereço do servidor e
os endereços extras; na linha por registro, o IP do servidor ou, quando ele é um nome, os endereços
para os quais o nome resolve (até 16), mais os endereços extras. O endereço liberado para a linha de
uma organização nunca entra na linha de outra. Se o nome da operadora deixar de resolver, a linha
continua aceitando os endereços que o nome tinha da última vez, mas um endereço extra que você
removeu deixa de ser aceito na hora. Enquanto a central ainda não souber de que endereços uma linha
por registro recebe (o nome nunca resolveu e não há endereço extra), o filtro dessa linha fica
desligado e a tela diz isso. A porta 5060 continua publicada como antes, e nada muda no instalador
nem no arquivo `.env`. Crédito: @webtecnica, pela medição numa instalação real que mostrou a central
respondendo a qualquer origem.

## Requer atenção

Depois de atualizar, abra Linha telefônica e confira, em cada linha, a lista "Aceita ligações de".
A linha por IP e a linha por registro cuja operadora entrega a ligação pelo mesmo servidor do
registro seguem sem ação. Se a sua operadora registra a linha por um servidor e entrega as ligações
por outro, inclua os endereços de entrega em "Endereços extras de onde as ligações chegam" e salve:
sem isso, as ligações dela deixam de chegar. Se as ligações de uma linha pararem de chegar depois da
atualização, é esse o primeiro lugar para olhar.

---
impact: operator_action
section: changed
title: A central só aceita a ligação de uma linha que vem dos endereços dela
---

A central de telefonia passa a filtrar a entrada linha por linha: cada linha só aceita ligações
dos endereços que a tela mostra em "Aceita ligações de", e a ligação que se apresenta como aquela
linha vinda de qualquer outro endereço é recusada. Na linha por IP, valem o endereço do servidor e
os endereços extras; na linha por registro, o IP do servidor ou, quando ele é um nome, os endereços
que o nome devolveu nas últimas 24 horas (até 16), mais os endereços extras. Juntar as respostas
de 24 horas evita recusar uma ligação válida quando o DNS da operadora devolve só uma parte dos
endereços a cada consulta. O endereço liberado para a linha de uma organização nunca entra na linha
de outra. Se o nome da operadora deixar de resolver, a linha continua aceitando os endereços que o
nome tinha, mas um endereço extra que você removeu deixa de ser aceito na hora. Enquanto o nome de
uma linha por registro nunca tiver resolvido, o filtro dessa linha fica desligado, mesmo com
endereços extras, e a tela diz isso. Na linha por registro, o filtro se liga e se desliga na tela,
com os botões "Ligar o filtro" e "Desligar o filtro"; a linha por IP filtra sempre. A porta 5060
continua publicada como antes, e nada muda no instalador nem no arquivo `.env`. Crédito:
@webtecnica, pela medição numa instalação real que mostrou a central respondendo a qualquer origem.

## Requer atenção

Nenhuma linha que já existe é cortada na atualização. A linha por IP passa a filtrar sem perder
nada: ela já só era reconhecida pelo endereço do servidor e pelos endereços extras, que são a mesma
lista do filtro. A linha por registro que já existe fica sem filtro, como antes, até alguém ligar
na tela: a tela mostra "Filtro desligado nesta linha" e o botão "Ligar o filtro". A linha por
registro cadastrada depois da atualização já nasce com o filtro ligado.

Depois de atualizar, abra Linha telefônica e, em cada linha por registro, confira a lista "Aceita
ligações de". Se a sua operadora registra a linha por um servidor e entrega as ligações por outro,
inclua os endereços de entrega em "Endereços extras de onde as ligações chegam" e salve antes de
ligar o filtro. Depois clique em "Ligar o filtro". Se as ligações de uma linha pararem de chegar
depois de ligar o filtro, inclua o endereço que falta em Endereços extras ou use "Desligar o filtro".

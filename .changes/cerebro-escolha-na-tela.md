---
impact: new_capability
section: added
title: Quem lê a ligação se escolhe na tela, e o custo não medido aparece como não medido
---

Na seção da análise, em Configurações, "Quem lê a ligação" escolhe entre o motor do agente (o
padrão, como antes) e um cérebro com chave aceita em Configurações → Cérebros, com um modelo da
lista dele, buscável por nome. Ao escolher um modelo sem preço conhecido, um aviso diz, antes de
salvar e depois de salvo, que o custo da análise não vai ser medido e que ela só roda nas ligações
de agentes com teto de custo. Se o cérebro escolhido perde a chave, ou o modelo sai da lista, a tela
diz que as ligações não estão sendo lidas. Remover a chave do cérebro escolhido avisa isso antes.
Em Custos e na tela da chamada, a ligação lida por um modelo sem preço mostra "não medido", e nunca
um custo zero como se fosse grátis. Na API, `GET /api/v1/system/costs` ganha `unmeasuredCount` no
total e em cada dia, agente e motor, e `GET /api/v1/calls/{id}` ganha `unmeasuredCount` no total da
chamada: quantas linhas do extrato não têm custo medido. Os campos de antes não mudam. A lista de modelos de um cérebro que falha ao ser relida
continua a guardada, marcada como velha. Sem escolha, nada muda em instalações existentes. Crédito: @melgarafael.

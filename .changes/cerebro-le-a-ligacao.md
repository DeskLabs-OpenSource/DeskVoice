---
impact: new_capability
section: added
title: O desfecho e a análise da ligação podem ser lidos por um cérebro escolhido
---

Com a chave de um cérebro salva em Configurações → Cérebros, a configuração `calls.analysis_brain`
escolhe um cérebro e um modelo da lista dele para ler as ligações: o desfecho e a análise passam a
sair desse modelo, na frente do motor de voz e do endpoint de classificação. O extrato de custo
ganha o modelo cobrado e a marca de custo medido. Um modelo sem preço conhecido só é aceito com
confirmação, só lê ligações de agentes com teto de custo, e a linha dele no extrato fica marcada
como não medida, nunca como zero. Se o cérebro escolhido ficar sem chave, sumir ou o modelo sair da
lista, a ligação não é lida, a linha do tempo diz por quê, e nada vai ao motor de voz. A escolha na
tela vem na próxima versão; sem escolha, tudo segue como antes. Nada muda em instalações
existentes. Crédito: @melgarafael.

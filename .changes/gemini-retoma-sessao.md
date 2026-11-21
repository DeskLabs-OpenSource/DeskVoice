---
impact: nothing_changes
section: fixed
title: No Gemini Live, o motor passa a retomar a sessão quando o Google troca a conexão
---

O Google fecha a conexão da Live API em cerca de 10 minutos, e o tempo máximo padrão de uma ligação é de 10 minutos: uma ligação longa com o motor Gemini Live podia cair perto desse ponto. Agora o motor pede ao Google um identificador para retomar a sessão e liga a compressão do contexto. Quando o Google avisa que vai fechar a conexão, ou quando ela cai depois de o motor ter recebido esse identificador, o motor abre outra conexão com ele, sem encerrar a ligação e sem fala a mais. A troca aparece na linha do tempo da chamada, e o consumo das duas conexões entra no custo. Se a retomada falhar depois do aviso do Google, a ligação segue pela conexão de antes até o Google fechá-la, e aí cai como antes, com o aviso de falha do motor; se falhar depois de uma queda, cai na hora, também como antes. Isso foi conferido contra um servidor falso. Uma ligação real de mais de 10 minutos ainda não foi feita, e não se sabe se quem está na linha percebe a troca. Nada a fazer ao atualizar. Crédito: @melgarafael.

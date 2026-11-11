---
impact: operator_action
section: changed
title: Painel e voz do navegador saem por um endereço só, em todo modo de instalação
---

"Falar com o agente" deixou de precisar de uma segunda porta. O proxy do DeskVoice (Caddy) agora sobe sempre e é a única entrada: com as portas 80 e 443 livres, nada muda para você; com elas ocupadas por outro proxy, o DeskVoice inteiro fica atrás de uma porta local só (a mesma em que o painel já estava). A checagem de saúde ganhou a linha "Entrada única", que acusa quando o painel abre e a voz não, e a tela passou a dizer o que falta em vez de mandar conferir a internet. Crédito: @melgarafael

## Requer atenção

Depois de atualizar, rode `bash install/install.sh` de novo: ele passa a instalação para o formato de uma porta e mostra as instruções do seu caso. Quem usa proxy próprio com domínio precisa trocar o destino: o domínio inteiro vai para a porta do painel (a regra separada de `/voice-ws` para a segunda porta deve ser apagada), e o proxy precisa repassar WebSocket. Quem entra por túnel SSH volta a abrir uma porta só: `ssh -L 3080:127.0.0.1:3080 usuario@ip-da-vps`. Até rodar o instalador, o painel pode ficar inacessível de fora em instalações que usavam o proxy do DeskVoice nas portas 80 e 443.

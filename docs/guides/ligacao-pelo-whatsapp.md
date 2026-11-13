# Conectar o número à ligação pelo WhatsApp

A ligação pelo WhatsApp faz o agente atender quem liga para a empresa pelo WhatsApp, com as mesmas
ferramentas, aviso de gravação e tetos da ligação pelo telefone. Instale o serviço, conecte o número
e escolha o agente que atende. Em Chamadas, a ligação pelo WhatsApp aparece como uma ligação
recebida, com o número de quem ligou. Quando o WhatsApp esconde o número (`@lid`), o que hoje é o
caso comum, vale o telefone que a própria chamada informa, sem confirmação do WhatsApp, como o número
que a operadora repassa. Quem repassa esse telefone é a imagem do WaCalls que o kit usa, um fork com o
conserto (JotaDev66/WaCalls#69) até os autores o publicarem; com a imagem oficial (d16a076), quem
liga com o número oculto apareceria como número não identificado. Provado numa ligação real em
13/11/2026. A ligação ainda não tem um canal "WhatsApp" próprio na lista e na linha do tempo.

O desenho completo, com o que se sabe e o que não se sabe, está em
[`docs/specs/2026-11-12-ligacao-pelo-whatsapp.md`](../specs/2026-11-12-ligacao-pelo-whatsapp.md).

## Antes de conectar: o risco

O serviço é o [WaCalls](https://github.com/JotaDev66/WaCalls), um cliente **não oficial** do
WhatsApp: ele conecta o número como mais um aparelho vinculado, como o WhatsApp Web, e fala o
protocolo de chamada do WhatsApp sem a API oficial da Meta. Os termos do WhatsApp proíbem acesso
automatizado e preveem suspender a conta. Na prática:

- o número pode ser restringido ou bloqueado, sem aviso;
- use um número dedicado ao atendimento, nunca o seu pessoal;
- a imagem do WaCalls é a do canal `develop` dos autores, de julho de 2026, sem versão publicada.
  Se o WhatsApp passar a exigir um cliente mais novo, o pareamento pode parar de funcionar.

## O mesmo número no WhatsApp por QR Code e na ligação

Pode (decisão do dono em 12/11/2026). São dois aparelhos conectados ao mesmo WhatsApp, e a tela avisa
quando o número é o mesmo: se ele for bloqueado, as mensagens e as ligações param juntas.

O WhatsApp aceita até quatro aparelhos conectados a um número, e as ligações tocam em todos eles.
Com mais de quatro (contas com Meta Verified, por exemplo), as ligações tocam só no celular, e este
serviço deixa de recebê-las.

## Instalar o serviço

Em **Configurações → WhatsApp**, no bloco Ligação pelo WhatsApp, um dono ou administrador clica em "Instalar o serviço de
ligação pelo WhatsApp". O painel só grava o pedido; o agente do servidor (`install/agent.sh`, uma
passada por minuto) confere o disco (1,2 GB livres), baixa a imagem e sobe o serviço. A tela
acompanha.

O que ele custa: a imagem tem 18,5 MB comprimidos (registro de imagens, 12/11/2026). Memória e disco
com o serviço de pé **ainda não foram medidos**; o teto de memória é de 256 MB.

O serviço fica só na rede interna do servidor, sem porta publicada. Quem fala com ele é o processo
de voz, com um token que o instalador gerou e ninguém digita.

## Conectar

1. Clique em "Conectar". Em alguns segundos aparece um QR Code.
2. No celular do número, abra o WhatsApp → Mais opções (ou Configurações) → Dispositivos conectados
   → Conectar dispositivo, e leia o código.
3. A tela mostra o número conectado e desde quando, e deixa um aviso no painel.

O código é trocado sozinho e vale poucos minutos. Se ninguém o ler a tempo, a tela diz e oferece
"Gerar novo código": a tentativa anterior é apagada e outra começa.

## O agente que atende

Com o número conectado, escolha em "Quem atende" o agente das ligações pelo WhatsApp. Sem agente
escolhido, nada é atendido, e a checagem de saúde avisa.

- O agente atende assim que a ligação chega (decisão do dono em 12/11/2026). O celular da empresa
  toca e para.
- O aviso de gravação sai antes da saudação, como no telefone, e valem os tetos de custo e de duração
  do agente.
- A ligação pelo WhatsApp conta no mesmo limite de ligações recebidas ao mesmo tempo das que chegam
  pela operadora (Configurações).
- **Não atendida pelo agente** (nenhum agente escolhido, agente desligado ou limite atingido): ela
  continua tocando no celular e nos aparelhos de quem trabalha, a recusa aparece em Chamadas, e o
  painel recebe um aviso. O DeskVoice nunca recusa a ligação no WhatsApp.
- **Não há transferência** neste canal: quando alguém pede para falar com a equipe, o agente oferece
  deixar um recado (`notify_human`). O número de transferência do agente não vale aqui.
- **Motor sem chave ou que cai no meio:** quem ligou ouve o sinal de falha (três bipes), a ligação
  cai, e o painel recebe o aviso, como no telefone.

O áudio é o do resto do DeskVoice, 8 kHz: o WhatsApp entrega 16 kHz, e a voz fica com qualidade de
telefone fixo.

## Quando o número cai

Se alguém remover o aparelho em Dispositivos conectados, ou o WhatsApp encerrar a conexão, a tela e
a checagem de saúde (linha "Ligação pelo WhatsApp") mostram o número como desconectado, e o painel
recebe um aviso. O WhatsApp desconecta os aparelhos vinculados quando o celular principal fica mais
de 14 dias sem uso. Para voltar, "Conectar de novo" e ler o código outra vez.

A queda só é percebida quando alguém abre o painel (a tela ou a saúde), como no WhatsApp por QR Code.

## Desconectar e remover

"Desconectar" tira o aparelho do celular e apaga a sessão no serviço. "Remover o serviço" só vale sem
número conectado: o agente para o contêiner e tira a imagem do disco. O volume `wacalls-data`, com o
pareamento, fica no servidor, e não entra no backup. Depois de restaurar um backup ou de mudar de
servidor, é preciso ler o QR Code de novo.

## Na VPS

- Estado do serviço: `bash install/healthcheck.sh` (linha "Ligação pelo WhatsApp").
- Registros: `docker compose -f deploy/docker-compose.yml --profile whatsapp-calls logs --tail 50 wacalls`.
- O que o agente fez: `deploy/agent/agent.log`.

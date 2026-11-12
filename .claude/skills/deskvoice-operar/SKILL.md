---
name: deskvoice-operar
description: 'Operar uma instalação do DeskVoice que já está rodando: configurar um agente, a linha telefônica e as regras de ligação de saída; ler a linha do tempo de uma chamada; entender e limitar custos; conectar um WhatsApp por QR Code; atualizar, fazer backup, restaurar e diagnosticar. Use quando a pessoa perguntar "como configuro o agente", "como escrevo as instruções", "por que o agente transferiu", "o que aconteceu nessa ligação", "quanto custou", "como ligo as ligações de saída", "como atualizo", "como faço backup", "o agente não está usando a ferramenta", "como conecto o WhatsApp", "o WhatsApp caiu", "o QR Code não aparece".'
---

# Operar o DeskVoice

Tudo aqui se faz **pelo painel**. Se um passo parece pedir SSH ou edição de arquivo, pare: ou há
uma tela para isso, ou é defeito (abra uma issue). As exceções são os scripts de `install/`, no
fim.

Não invente tela, campo ou número: confira no painel da pessoa, ou no código
(`apps/panel/src/app/`), antes de afirmar.

## 1. Configurar um agente (tela Agentes)

| Campo | Como preencher bem |
|---|---|
| Nome e papel | Quem ele é para quem liga: "Ana, recepção" |
| Instruções | Quem é, o que resolve, o que **não** resolve e **quando chama um humano**. Frases curtas: é fala, não texto. Diga o que fazer quando não souber ("ofereça transferir") |
| Saudação | A primeira frase que a pessoa ouve. Com saudação, o agente fala primeiro |
| Motor de voz | Gemini Live ou OpenAI Realtime (pedem a chave, em Configurações), ou o simulado para demonstração |
| Ferramentas | Ligue **só** as que as instruções mandam usar. Ferramenta ligada sem instrução é chamada na hora errada |
| Duração máxima | Padrão de 600 segundos. Ao atingir, a chamada encerra com aviso |
| Teto de custo por chamada | Padrão de 500 centavos. Ao atingir, a chamada encerra e a linha do tempo registra |
| Número de transferência | Para onde vai quando precisa de uma pessoa. Sem ele, `transfer_to_human` não tem destino |

Ferramentas da fundação: `end_call`, `transfer_to_human`, `notify_human`, `request_approval`,
`send_whatsapp`, `call_webhook`, `create_task`.

**Teste sempre ligando.** Mudou as instruções? Ligue, faça o caso difícil e leia a linha do tempo.

## 2. Configurar a linha (tela Linha telefônica)

1. Cadastre o **tronco**: servidor, usuário, senha e modo de autenticação, **registro** ou **IP**
   (a operadora informa qual). A senha é cifrada no banco.
2. Use a **verificação** da própria tela. Ela diz se o tronco registrou e, se não, o erro.
3. Cadastre o **número** em formato internacional (`+5531999998888`) e **ligue o número ao agente**.

A tela gera a configuração do Asterisk: não há arquivo para editar. Tronco não registra: usuário e
senha, modo, e, no modo por IP, se a operadora liberou o IP público da VPS. Ligação muda é rede:
skill `deskvoice-instalar`.

## 3. Ligações de saída (tela Ligações de saída)

Vêm **desligadas**, de propósito. Para ligar, o dono da instalação declara a **finalidade** e a
**base legal**. A partir daí valem, sempre:

| Regra | Padrão |
|---|---|
| Teto diário por linha | 200 |
| Janela de horário | 09:00 às 20:00, no fuso configurado (`America/Sao_Paulo`) |
| Tentativas por contato | 3 |
| Lista de não ligar | Número nela nunca é chamado. Pediu para não receber ligação? Entra na lista |
| Aviso de gravação | Falado no início da chamada |

Toda ligação de saída passa por essa checagem, e cada recusa tem um motivo próprio que aparece na
tela. **Não há importação de lista para discagem, nem jeito de afrouxar o teto por fora da tela**:
disparo em massa bloqueia a linha de quem usa e prejudica quem recebe. Não ajude a contornar.

Antes de ligar o recurso, leia com a pessoa
[`ligacoes-de-saida.md`](../../../docs/doctrine/ligacoes-de-saida.md) e
[`conformidade-brasil.md`](../../../docs/guides/conformidade-brasil.md). Regra de telecomunicação
muda: confira a fonte e a data antes de afirmar o que é permitido.

## 4. Ler a linha do tempo de uma chamada (tela Chamadas → a chamada)

Cada passo é um evento, em ordem. É a primeira coisa a olhar quando alguém pergunta "o que
aconteceu nessa ligação?".

| Evento | Quer dizer |
|---|---|
| `call_started`, `call_answered` | A ligação chegou e o agente atendeu |
| `recording_notice` | O aviso de gravação foi falado |
| `transcript_user`, `transcript_agent` | O que cada lado disse |
| `tool_called`, `tool_result` | O agente usou uma ferramenta, e o que ela devolveu |
| `approval_requested`, `approval_decided` | O agente pediu autorização à equipe, e a resposta (ou o prazo que venceu) |
| `human_notified` | Alguém da equipe foi avisado |
| `transfer_started`, `transfer_completed` | A ligação foi passada para uma pessoa |
| `engine_failed` | O motor de voz caiu no meio; quem ligou ouviu uma desculpa |
| `call_refused` | A chamada foi recusada ao atender; o motivo vem junto (ex.: `engine_not_configured`) |
| `cost_ceiling_reached` | Bateu o teto de custo e encerrou |
| `call_ended` | Fim, com o motivo |
| `task_queued`, `task_finished` | O que ficou rodando depois (resumo, aviso, webhook) |

Perguntas comuns, e onde está a resposta:

- **"O agente não usou a ferramenta."** Não há `tool_called`? A ferramenta está desligada no
  agente, ou as instruções não mandam usá-la naquele caso. Há `tool_called` com `tool_result`
  de falha? Leia a mensagem: é configuração faltando ou serviço fora do ar.
- **"Transferiu sem motivo."** Leia a transcrição logo antes de `transfer_started`. Em geral as
  instruções mandam transferir "na dúvida" e são amplas demais.
- **"Ficou esperando e desligou."** `approval_requested` sem resposta: ninguém da equipe decidiu
  no prazo, e valeu o padrão do pedido. Veja a tela Aprovações e quem recebe os avisos.
- **"Caiu no meio."** `engine_failed`: conta ou limite de uso no provedor de IA.

## 5. Custos (tela Custos)

- Cada chamada tem custo registrado, por motor, a partir do consumo que o provedor informa. É
  **estimativa** pelo preço de tabela conferido na data que o motor declara: a fatura do provedor
  é a que vale.
- O custo da IA não inclui a operadora (minutos do tronco) nem a VPS.
- Para gastar menos: instruções mais curtas e diretas, duração máxima menor, teto por chamada
  menor, e transferir cedo o que o agente não resolve.
- Guia: [`custos.md`](../../../docs/guides/custos.md).

## 6. WhatsApp por QR Code (tela Configurações → WhatsApp)

O agente avisa a equipe e escreve para quem está na ligação por um número de WhatsApp conectado
por QR Code. Só dono e administrador veem o bloco. **Ainda sem prova com um número real**: trate
a primeira conexão como teste.

**O serviço não vem instalado.** Ele custa cerca de 323 MiB de memória sem número conectado e 3,2 GB em
disco (medido na 0.3.0, em 12/11/2026, numa VPS de 8 GB; com um número conectado ainda não foi
medido), quase o mesmo que os cerca de 380 MiB do DeskVoice inteiro parado. Diga o custo antes de mandar instalar, e não instale em quem não vai usar.

Antes de conectar, diga o risco à pessoa, sem amenizar: é um **cliente não oficial** do WhatsApp
(o WAHA), o número **pode ser bloqueado**, e por isso tem de ser um **número dedicado**, nunca o
pessoal nem o principal da empresa.

| Passo | O que acontece |
|---|---|
| Instalar o serviço | Botão "Instalar o serviço de WhatsApp". O painel só registra o pedido; o agente do servidor (o da atualização pela tela) baixa e sobe o serviço em alguns minutos, e a tela acompanha |
| Conectar | A tela mostra o QR Code. No celular do número: WhatsApp → Dispositivos conectados → Conectar dispositivo. O código é trocado sozinho (60 s o primeiro, 20 s os seguintes, até 6); venceu, "Gerar novo código" |
| Já havia conector externo | A tela avisa que ele será substituído e pede a confirmação. O token gravado é apagado |
| Conectado | A tela mostra o número e desde quando. "Enviar mensagem de teste" manda para o WhatsApp de quem está logado, o de "Meu contato" |
| Desconectar | Pede confirmação nomeando o número. O aparelho some de "Dispositivos conectados", e para voltar é preciso ler o QR Code de novo |
| Remover o serviço | Só aparece sem número conectado. Em até um minuto libera a memória e apaga do disco a imagem do serviço (3,2 GB), e só ela. O pareamento antigo fica guardado, sem uso: reinstalar pede o QR Code de novo. Peça à pessoa para conferir no celular do número, em Dispositivos conectados, se o aparelho saiu |

Quando algo não sai:

| O que a pessoa vê | Causa | O que fazer |
|---|---|---|
| "A conexão caiu" | O aparelho foi removido no celular, ou o WhatsApp encerrou a sessão | Conectar de novo; pode pedir QR Code |
| "A sessão está parada" | O serviço reiniciou e não retomou | Conectar de novo; não pede QR Code |
| "O serviço não tem mais os dados" | Backup restaurado em outra VPS: o pareamento não entra no backup | Conectar de novo e ler o QR Code |
| "Preparando o serviço" que não termina, com aviso de que o agente não fala ou não responde | Quem instala é o agente, e ele não está passando | No servidor: `bash install/agent.sh` executa o pedido na hora; `sudo bash install/agent.sh --install` devolve o agendamento |
| "O servidor não tem espaço em disco", com quanto falta | O agente exige 5 GB livres antes de baixar; nada foi baixado | Liberar espaço (`backups/`) ou aumentar o disco; ele confere de novo em cerca de 10 minutos |
| Aviso de pouca memória com o serviço de pé | Ao instalar havia menos memória disponível que o teto do serviço (1280 MB) | Não impede o uso; acompanhar, e remover o serviço se o servidor apertar |
| "Os arquivos não saíram do disco" depois de remover | Outra coisa no servidor usa a mesma imagem | O servidor tenta de novo a cada minuto; na hora: `bash install/agent.sh`. Nunca mande rodar `docker image prune` ou `docker system prune`: apaga imagem de outros sistemas |
| "O servidor não conseguiu baixar o serviço" | Internet, Docker Hub fora ou no limite de downloads, ou disco cheio | `df -h`; o servidor tenta de novo sozinho em cerca de 10 minutos; registro em `deploy/agent/agent.log` |
| "Este servidor ainda não tem a chave do serviço" | Atualizado por um atualizador antigo | `bash install/update.sh` uma vez |
| "O serviço de WhatsApp não respondeu" | O contêiner `waha` parou | `bash install/healthcheck.sh`, linha "WhatsApp"; log: `docker compose -f deploy/docker-compose.yml --profile whatsapp logs --tail 50 waha` |
| Mensagem não chegou, tela diz conectado | O destino não tem WhatsApp, ou o WhatsApp restringiu o número | Linha do tempo da chamada, evento `tool_result`. Com o número restrito, **não** desconecte nem reconecte: pare de escrever para contatos novos e espere |

Limites para dizer com clareza:

- A tela só percebe a queda quando alguém a abre. Com a tela fechada, o envio falha com o motivo
  na linha do tempo, sem alerta.
- Um número por organização. O WAHA é o da própria instalação; não dá para apontar para outro.
- Não oriente ninguém a mandar mensagem para lista, nem a escrever primeiro para desconhecidos:
  é o que bloqueia o número, e disparo em massa não entra no DeskVoice.
- Se o serviço não responder à consulta do endereço do número, a mensagem sai mesmo assim, para
  o número como ele é, e a linha do tempo diz que o endereço não foi conferido.
- Um aviso por WhatsApp que falha aparece na linha do tempo da chamada como tarefa que falhou; o
  motivo não aparece na tela nesta versão.

Guia: [`whatsapp-por-qr-code.md`](../../../docs/guides/whatsapp-por-qr-code.md).

## 7. Manter a instalação (na VPS, na pasta do projeto)

| Tarefa | Comando | O que saber |
|---|---|---|
| Ver a saúde | `bash install/healthcheck.sh` | Uma linha por peça; `aviso` é configuração faltando, `falha` é quebrado |
| Backup | `bash install/backup.sh` | Só diz "concluído" depois de restaurar o dump num rascunho e contar as linhas. Guarde cópia fora da VPS |
| Atualizar pela tela | Configurações → Versão e atualização | Mostra a versão em execução, a mais recente publicada e as notas entre as duas. Dono ou administrador clica em atualizar e confirma com a senha; o sistema sai do ar por alguns minutos e **as chamadas em andamento caem**. Quem executa é o agente do servidor, que lê do painel só um sim ou não. A versão nomeada na confirmação é a que o servidor anunciou; enquanto as notas dela não estiverem publicadas, a tela não oferece o botão, e se sair outra versão entre a confirmação e a execução o pedido termina sem alterar nada ("saiu uma versão mais nova": é só pedir de novo). A tela diz o resultado: atualizou, não foi aplicada (segue na versão anterior) ou falhou, com o fim da saída do atualizador; a saída inteira das três últimas atualizações fica no servidor em `deploy/agent/last-update.log` (e `.1`, `.2`). Se a tela disser que o agente não está instalado ou não responde, ou que a instalação é `local`, ela mostra o comando; o registro do agente fica em `deploy/agent/agent.log`, e `bash install/healthcheck.sh` tem a linha "Agente de atualização". Um pedido parado vence sozinho (15 minutos sem o agente pegar, 30 sem resultado) e outro pode ser feito. Guia: [`atualizar.md`](../../../docs/guides/atualizar.md) |
| Atualizar pelo terminal | `bash install/update.sh` | Faz backup, troca a versão, aplica as migrations e confere a saúde; se não ficar saudável, volta sozinho. Vai para a versão publicada mais recente, ou para a de `--to 0.3.0`. Nunca constrói imagem: se a versão não baixa, para antes de mexer em qualquer coisa e diz o comando para testar. Leia antes as notas da versão: se o título diz "requer atenção", há algo a fazer. Quem veio da 0.1.0 roda uma segunda vez depois de atualizar: é ela que instala o agente da atualização pela tela |
| Agente de atualização | `sudo bash install/agent.sh --install` | Instala ou conserta o agendamento do agente (timer do systemd `deskvoice-agent.timer`; sem systemd, cron). `--dry-run` só diz o que faria. O instalador e o `update.sh` já fazem isso sozinhos |
| Restaurar | `bash install/restore.sh latest` | **Substitui o banco atual.** Confere as contagens antes de trocar. Mudando de VPS: `--with-config`. O pareamento do WhatsApp não vem no backup: em outra VPS, leia o QR Code de novo |
| Pedir ajuda | `bash install/diagnose.sh` | Gera um arquivo sem segredos para anexar numa issue |

Antes de restaurar, confirme com a pessoa, nomeando o que será substituído.

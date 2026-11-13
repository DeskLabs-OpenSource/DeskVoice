# Conectar um WhatsApp por QR Code

O DeskVoice envia avisos para a equipe e mensagens para quem está na ligação por WhatsApp. O
jeito mais direto de dar um número a ele é ler um QR Code, como no WhatsApp Web. Quem mantém a
sessão é o [WAHA](https://github.com/devlikeapro/waha), um serviço à parte, que só é alcançado
de dentro da instalação.

**O serviço não vem instalado.** Ele custa mais que o DeskVoice inteiro, então só existe no
servidor de quem pede. Você o instala pela tela, e remove quando quiser.

| O que o serviço custa | Medido na 0.3.0, em 12/11/2026, numa VPS de 8 GB |
|---|---|
| Memória, com o serviço parado (sem número conectado) | cerca de 323 MiB (o DeskVoice inteiro, parado e sem ele, usa cerca de 380 MiB) |
| Memória, com um número conectado | **ainda não medido**. O teto é de 1280 MB |
| Disco | 3,2 GB |
| Para baixar e subir | menos de um minuto naquela VPS; a tela fala em alguns minutos |

**Estado da prova:** construído e testado contra um WAHA falso. Até 11/11/2026 nenhum número real
foi conectado por este caminho, nenhum QR Code foi lido e nenhuma mensagem saiu. Trate a primeira
conexão como teste.

## Antes de conectar: o risco

O WAHA é um **cliente não oficial** do WhatsApp. Não é a API oficial da Meta. O WhatsApp pode
restringir ou bloquear o número conectado, sem aviso e sem recurso garantido. Isso não é defeito
do DeskVoice e não há configuração que elimine o risco. O que o reduz:

- **Use um número dedicado.** Nunca o seu pessoal, nunca o principal da empresa. Se for
  bloqueado, você perde só o canal de avisos.
- **Não escreva primeiro para desconhecidos.** É o que mais leva a bloqueio. O agente só envia
  para o número de quem está na ligação ou para a equipe cadastrada, e a mensagem para quem ligou
  pede a confirmação de uma pessoa, porque o número exibido numa ligação pode ser forjado
  (Configurações → WhatsApp → "Enviar direto para quem ligou"). Mesmo confirmada, essa mensagem é uma
  conversa iniciada pelo seu número com alguém que talvez nunca tenha falado com ele.
- **Poucas mensagens por hora.** O guia do WAHA fala em no máximo 4 mensagens por hora para um
  mesmo contato, com pausa entre elas, e em nunca enviar em sequência para muitos contatos. O
  DeskVoice já limita a 5 mensagens por ligação.
- **Deixe o número com cara de número de verdade:** foto, nome e uso normal antes de conectar.
- **Nada de disparo.** O DeskVoice não tem e não terá envio em massa.

Fonte das boas práticas: [How to avoid blocking](https://waha.devlike.pro/docs/overview/how-to-avoid-blocking/),
lido em 11/11/2026. As regras do WhatsApp mudam; confira a página antes de confiar nos números.

Se o WhatsApp restringir o número (mensagens para contatos novos falham, mas a sessão continua
conectada), **não desconecte nem conecte de novo**: isso não tira a restrição. Pare de enviar para
contatos novos e espere.

## Instalar o serviço

Só o dono e os administradores veem o bloco.

1. Abra **Configurações → WhatsApp**. A tela diz "O serviço de WhatsApp não está instalado neste
   servidor", com o custo.
2. Clique em **Instalar o serviço de WhatsApp**. O painel só registra o pedido: quem baixa e
   sobe o serviço é o agente do servidor, o mesmo da atualização pela tela, que passa uma vez por
   minuto.
3. A tela mostra "Preparando o serviço" e acompanha sozinha. Quando o serviço está de pé, aparece
   o botão **Conectar**, e um aviso chega ao painel.

| A tela diz | O que é | O que fazer |
|---|---|---|
| O agente ainda não falou com o painel, ou não está respondendo | Quem instala o serviço é o agente, e ele não está passando | Rode no servidor `bash install/agent.sh` (executa o pedido na hora). Para ele voltar a passar sozinho: `sudo bash install/agent.sh --install` |
| O servidor não tem espaço em disco, com quanto falta | O agente confere o disco antes de baixar e exige 5 GB livres. Nada foi baixado | Libere espaço (backups antigos em `backups/`) ou aumente o disco. Ele confere de novo em cerca de 10 minutos |
| Aviso de pouca memória, com o serviço de pé | Ao instalar, o servidor tinha menos memória disponível que o teto do serviço (1280 MB). Não impede o uso | Acompanhe o servidor; se faltar memória, remova o serviço ou aumente a VPS |
| O servidor não conseguiu baixar o serviço | Internet do servidor, o Docker Hub fora do ar ou o limite de downloads dele, ou disco cheio | Confira o disco (`df -h`). O servidor tenta de novo sozinho em cerca de 10 minutos |
| O servidor baixou o serviço, mas ele não subiu | Costuma ser falta de memória ou de disco | `docker compose -f deploy/docker-compose.yml --profile whatsapp logs --tail 50 waha` |
| Este servidor ainda não tem a chave do serviço | A atualização foi feita por um atualizador antigo | Rode `bash install/update.sh` no servidor, uma vez |

## Conectar

1. Com o serviço de pé, leia o aviso do bloco.
2. Clique em **Conectar**. Se já havia um conector externo (DeskcommCRM ou webhook próprio), a
   tela avisa que ele será substituído e pede a confirmação: o token gravado é apagado.
3. Em alguns segundos aparece o QR Code. No celular do número: **WhatsApp → Mais opções (ou
   Configurações) → Dispositivos conectados → Conectar dispositivo**, e aponte a câmera.
4. O código é trocado sozinho: o primeiro vale 60 segundos e os seguintes 20, até 6 códigos.
   Depois disso a tentativa é encerrada e a tela oferece **Gerar novo código**.
5. Conectou: a tela mostra o número e desde quando, e um aviso aparece no painel.
6. Clique em **Enviar mensagem de teste**. Ela vai para o **seu** WhatsApp, o cadastrado em
   "Meu contato", no começo da mesma página. Sem número cadastrado, a tela pede que você cadastre.

A partir daí, `notify_human` avisa por WhatsApp cada pessoa da equipe com número cadastrado, e
`send_whatsapp` envia para quem está na ligação, com as mesmas regras de antes: destino só da
ligação ou da equipe, confirmação humana para o número exibido, 5 mensagens por ligação.

## O que a tela mostra

| Estado | O que quer dizer | O que fazer |
|---|---|---|
| Serviço não instalado | O padrão de toda instalação | Instalar o serviço, se quiser usar |
| Preparando o serviço | O servidor está baixando e subindo | Esperar alguns minutos |
| Removendo o serviço | O servidor está tirando o serviço | Esperar até um minuto |
| Desconectado | Nenhum número conectado. O serviço está de pé, sem sessão nenhuma | Conectar, ou remover o serviço |
| Preparando a conexão | A sessão está subindo | Esperar alguns segundos |
| QR Code | Esperando a leitura | Ler com o celular do número |
| Conectado | O número envia | Enviar mensagem de teste, ou desconectar |
| A conexão caiu | O aparelho foi removido no celular, ou o WhatsApp encerrou a sessão | **Conectar de novo.** Pode pedir um novo QR Code |
| A sessão está parada | O serviço reiniciou e não retomou a sessão | **Conectar de novo.** Não pede QR Code |
| O serviço não tem mais os dados | Backup restaurado em outro servidor, ou o volume foi apagado | **Conectar de novo** e ler o QR Code |
| O QR Code não foi lido a tempo | Os 6 códigos venceram | **Gerar novo código** |

**Limite desta versão:** a tela só percebe que a conexão caiu quando alguém a abre. Com a tela
fechada, uma queda aparece na próxima visita a Configurações, e até lá cada envio falha com o
motivo na linha do tempo da chamada. O aviso de queda na hora é a próxima fatia.

## Quando um envio falha

- **O número conectado caiu ou não está conectado:** o agente diz a quem está na linha que não
  conseguiu enviar, e o motivo fica no evento `tool_result` da linha do tempo. Nada tenta
  reconectar sozinho.
- **O destino não tem WhatsApp:** antes de enviar, o DeskVoice pergunta ao WhatsApp o endereço
  certo do número (no Brasil, o nono dígito nem sempre é o que o WhatsApp usa). Se o número não
  existe lá, o agente diz isso na ligação e nada é enviado.
- **O serviço não respondeu à consulta do endereço:** a mensagem sai mesmo assim, para o número
  como ele é, e a linha do tempo diz que o endereço não foi conferido. Se o WhatsApp guarda aquele
  número de outro jeito, a mensagem pode não chegar.
- **Um aviso por WhatsApp para a equipe não saiu:** o painel continua mostrando o aviso (ele vai
  sempre para o painel também). A falha do WhatsApp aparece na linha do tempo da chamada que o
  gerou, como tarefa que falhou; o motivo não aparece na tela nesta versão.

## Desconectar

**Configurações → WhatsApp → Desconectar.** A tela pede a confirmação nomeando o número. O
aparelho some de "Dispositivos conectados" no celular, os avisos e as mensagens por WhatsApp
deixam de sair e, para voltar, é preciso ler o QR Code outra vez.

Com um número conectado, o bloco "Conector externo de WhatsApp" fica travado. Para usar um
conector externo, desconecte o número antes.

## Remover o serviço

Sem número conectado, o bloco mostra **Remover o serviço de WhatsApp**. A confirmação diz o que
acontece: nenhum número fica conectado, os avisos por WhatsApp deixam de sair e a memória é
liberada. O agente para e remove o contêiner em até um minuto, e depois apaga do disco a imagem
do serviço (3,2 GB), e só ela.

- **Se a tela disser que os arquivos não saíram do disco:** outra coisa no servidor usa a mesma
  imagem. O servidor tenta de novo a cada minuto; para tentar na hora, `bash install/agent.sh`.
- **Confira o telefone.** Antes de remover, o painel tenta desfazer o pareamento. Se um número já
  foi conectado aqui, abra no celular dele **Dispositivos conectados** e remova este aparelho, se
  ele ainda estiver na lista.
- O pareamento antigo fica guardado no servidor (um volume do Docker), sem uso. Ao instalar de
  novo, o número **não** volta conectado sozinho: é preciso ler o QR Code.

Enquanto o serviço é baixado, uma atualização pedida pela tela espera no máximo 10 minutos: o
download tem esse prazo por passada do agente, e continua de onde parou na passada seguinte.

## Na VPS

| Assunto | O que vale |
|---|---|
| Serviço | `waha`, no `deploy/docker-compose.yml`, num perfil: só existe depois de instalado pela tela. Só na rede interna do Docker, sem porta publicada, com o painel e a documentação da API dele desligados |
| Memória | Cerca de 323 MiB sem número conectado (medido na 0.3.0). Com um número conectado, **ainda não medido**. Teto de 1280 MB (`mem_limit`) |
| Disco | 3,2 GB (medido) |
| Saúde | `bash install/healthcheck.sh`, linha "WhatsApp": "não instalado" é o estado normal e nunca é falha. Instalado, diz se o serviço responde. Qual número está conectado, só a tela diz |
| Log | `docker compose -f deploy/docker-compose.yml --profile whatsapp logs --tail 50 waha`. O que o agente fez: `deploy/agent/agent.log` |
| Atualização | Com o serviço instalado, a atualização baixa a imagem dele antes de mexer em qualquer coisa. Sem ele, não baixa nada |
| Backup | **O pareamento não entra no backup.** Ele mora no volume `waha-sessions`. Depois de restaurar em outro servidor, leia o QR Code de novo |
| Chave | `WAHA_API_KEY`, em `deploy/.env`, gerada pelo instalador. Nunca precisa ser digitada |

## Um número por instalação

Nesta versão cada organização conecta um número, e o WAHA é o da própria instalação. Apontar para
um WAHA que você já tem e conectar vários números são decisões em aberto, registradas em
[`0012`](../decisions/0012-whatsapp-por-qr-code.md).

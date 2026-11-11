# 0008: Chamada pelo navegador

- **Estado:** aceita
- **Data:** 2026-11-11
- **Quem decidiu:** o dono pediu a capacidade (conversar com o agente pelo painel, sem linha telefônica). As escolhas abaixo são do construtor e ficam abertas à revisão dele.

## Contexto

Aprovar um número de telefone leva dias. Sem ele, quem instala não tinha como ouvir o agente, só a chamada simulada, que segue um roteiro. Faltava um jeito de conversar de verdade antes de ter linha.

## Decisão

- **É uma chamada como as outras.** Mesma sessão, ferramentas, aviso de gravação, aprovação humana, teto de custo e de duração, resumo pós-chamada. Só o transporte muda: o áudio chega por WebSocket em vez de vir do Asterisk. Entra no histórico com `channel: "web"`.
- **Qualquer papel com sessão pode iniciar,** inclusive o operador. Quem atende precisa poder ouvir o agente que opera. O gasto é limitado pelos tetos abaixo, e não pelo papel.
- **Entrada por token de uso único.** O painel pede a chamada em nome de uma sessão autenticada; o processo de voz devolve um token de 32 bytes, válido por 60 s, guardado só em memória e preso àquela chamada. O WebSocket aceita qualquer origem, porque não usa cookie: o que protege é o token.
- **Teto de três chamadas pelo navegador ao mesmo tempo por organização,** contando as que esperam a conexão. Cada chamada já tinha teto de custo; sem este, o gasto somado não tinha limite.
- **Agente no motor simulado é recusado antes de abrir o microfone,** com a orientação de trocar o motor.
- **A porta de voz nunca é exposta direto na internet.** Com o Caddy do DeskVoice, vai pelo caminho `/voice-ws` na mesma origem. Sem ele, fica em `127.0.0.1`, alcançada pelo proxy que já existe ou por túnel SSH.
- **Áudio em 8 kHz,** o mesmo formato da telefonia. É o que a pessoa ouviria numa ligação.

### Emenda de 2026-11-11: uma origem só

O item acima, "a porta de voz nunca é exposta direto na internet", previa dois caminhos: pelo
Caddy do DeskVoice ou, sem ele, uma segunda porta local (o painel na 3080, a voz na 3081, com o
painel informando a porta ao navegador por `VOICE_WEB_PUBLIC_PORT`). O texto fica como registro
do que foi decidido; a parte da segunda porta deixou de valer.

O que aconteceu: no mesmo dia, o dono abriu um túnel SSH só para a porta do painel, clicou em
ligar e recebeu "a conexão com o serviço de voz caiu, confira sua internet". Uma capacidade que
pede uma segunda porta publicada cria um passo a mais em cada modo de instalação (túnel, proxy
do operador, firewall), e cada um falha em silêncio.

O que vale agora:

- **O Caddy do DeskVoice existe sempre** e é a única entrada do painel e da voz. Com as portas
  80 e 443 livres, escuta nelas. Com elas ocupadas por outro proxy, sobe só com HTTP numa porta
  local única; o proxy do operador, ou o túnel, aponta para essa porta e para mais nada.
- **O navegador usa sempre `/voice-ws` na mesma origem do painel.** `VOICE_WEB_PUBLIC_PORT`
  saiu do código e é removida do `app.env` na reinstalação. Painel e voz nunca publicam porta.
- **Endereço do visitante (limite de login).** Com o Caddy recebendo o visitante direto, ele
  descarta o `X-Forwarded-For` que chegar e o painel conta 1 salto. Atrás do proxy do operador,
  o Caddy confia só em vizinho de rede privada e o painel conta 2 saltos. Limite conhecido
  desse segundo modo: um proxy do operador que repasse o cabeçalho do visitante sem
  acrescentar o endereço real, ou um processo local falando direto com a porta única, consegue
  escolher o endereço que o painel lê.
- **A checagem de saúde passou a conferir a entrada** pelos dois caminhos (linha "Entrada
  única"). O limite conhecido "a checagem de saúde não confere se o proxy encaminha
  `/voice-ws`", listado em Consequências, fica reduzido a: ela confere o Caddy do DeskVoice, e
  não o proxy que o operador colocou na frente.
- **A tela diz o que falta.** Conexão que não abre, ou cai antes de a conversa começar, deixou
  de mandar conferir a internet: diz que o serviço de voz não foi alcançado no mesmo endereço
  e aponta o repasse de WebSocket e o `bash install/healthcheck.sh`.

Provado nesta data com um Caddy de verdade e o `Caddyfile` do repositório, na frente de um
servidor HTTP e de um servidor WebSocket de teste, inclusive atrás de um segundo Caddy no papel
de proxy do operador. Não provado: atrás de um Nginx ou Traefik de verdade, e a reinstalação
numa VPS.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| O navegador falar direto com o provedor de IA | Daria áudio melhor, mas a chamada sairia do caminho comum: ferramentas, aprovação, custo e histórico teriam uma segunda implementação, e só para um provedor |
| Passar o áudio pelas rotas do painel | O painel não mantém conexão de áudio contínua; viraria um repasse lento e frágil |
| Token na primeira mensagem, em vez de no endereço | Evitaria o token em registro de acesso de proxy. Fica como melhoria: o token vale uma vez e por 60 s, então o registro guarda algo já sem valor |
| Restringir a dono e administrador | Quem opera é quem mais precisa testar o agente |

## Consequências

- O navegador só libera o microfone em HTTPS ou em `localhost`. Instalação aberta pelo IP, sem domínio, não consegue usar esta tela sem túnel; a tela e o instalador dizem isso.
- Sem fone de ouvido, o microfone capta a fala do agente e ele se interrompe. A tela recomenda o fone.
- Limites conhecidos: o token aparece na URL do WebSocket; a fila de fala do agente no servidor não tem teto próprio; a checagem de saúde não confere se o proxy encaminha `/voice-ws`.
- Nada disto foi provado com um navegador de verdade nem com um motor real até a data deste registro.

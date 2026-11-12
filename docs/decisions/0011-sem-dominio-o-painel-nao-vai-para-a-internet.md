# 0011: Sem domínio, o painel não vai para a internet sem conexão segura

- **Estado:** aceita em 2026-11-12, opção A
- **Data:** 2026-11-11
- **Quem decidiu:** o dono do projeto, em 2026-11-12, antes do corte da 0.3.0, que é a primeira versão com esse padrão. A pergunta foi: "sem domínio, o painel fica só dentro do servidor e é preciso um túnel SSH para abri-lo; quem já instalou não muda; você aprova esse padrão?". A resposta foi sim. Os itens marcados **[construtor]** são escolhas de desenho, e continuam abertos à revisão.
- **Origem:** método da Fábrica, `manual/11-instalacao.md` (regras 3, 13 e 20) e itens 11.5, 11.16, 11.22 e 11.25 da conformidade.

## Contexto

Em 2026-11-11, uma instalação do zero numa segunda VPS, com as portas 80 e 443 livres e sem domínio, recebeu `DESKVOICE_PANEL_LOCAL_ONLY=1`. A opção foi ignorada em silêncio: ela só existia para o caso de as portas serem de outro proxy, e nesse modo o valor nem era validado. O Caddy publicou `0.0.0.0:80` e o instalador anunciou `http://<IP>` ([`instalacao-real.md`](../fundacao/instalacao-real.md)).

O defeito mostrou uma regra mais larga. Sem domínio não há HTTPS, e o padrão do instalador, com a porta 80 livre, era publicar a tela de login em HTTP para a internet: o e-mail e a senha do dono trafegam sem criptografia. Quem instala sem domínio "só para testar" é justamente quem menos percebe isso.

## Decisão **[dono]**: o padrão sem domínio

**Pergunta:** sem domínio, o instalador publica a tela de login na internet por HTTP, ou deixa o painel só dentro da VPS?

| Opção | O que é | Custo |
|---|---|---|
| **A. Só local (o padrão que vale)** | Sem domínio, o Caddy publica só em `127.0.0.1`, numa porta local. A pessoa entra por túnel SSH, com o comando que o instalador mostra, ou aponta um domínio e ganha HTTPS | Quem não sabe o que é um túnel SSH tem um passo a mais antes de ver o painel. O instalador entrega o comando pronto, mas é mais um conceito para quem instala pela primeira vez |
| **B. HTTP aberto, com aviso** | Como era: sem domínio e com a 80 livre, o painel abre em `http://<IP>` | A senha do dono trafega sem criptografia na primeira entrada, e a tela de login fica exposta a qualquer varredura. O aviso existe e é lido por poucos |
| **C. Recusar instalar sem domínio** | O instalador para e pede o domínio | Perde quem quer ver o produto antes de mexer em DNS, que é o caso de uso do "sem domínio" |

**Recomendação:** A. Quem instala sem domínio ainda está testando, e o custo de um túnel é pequeno perto do de uma senha lida no caminho. A opção B continua disponível, por pedido explícito.

**Resposta do dono (2026-11-12):** A. A 0.3.0 saiu com esse padrão. O que segue continua valendo: nenhuma instalação existente muda, porque reinstalar e atualizar mantêm a exposição que já estava. A também é o caminho reversível, porque voltar ao comportamento antigo é trocar o padrão de uma variável.

**Não medido:** quantas pessoas desistem no passo do túnel. Nenhuma instalação por pessoa de fora do projeto aconteceu ainda. Também não foi medido se algum provedor de VPS bloqueia o encaminhamento de portas por SSH.

**Pergunta em aberto, não medida:** a VPS parceira entrega algum nome com DNS pronto, apontado para a máquina? Se entregar, existe uma terceira via que esta decisão não considerou: HTTPS sem a pessoa ter um domínio próprio, o que tiraria o túnel do caminho de quem instala nela. Ninguém conferiu isso; a resposta pode mudar a recomendação.

## O que vale enquanto isso **[construtor]**

| Tema | O que vale | Onde está |
|---|---|---|
| Padrão sem domínio | Painel só em `127.0.0.1`, com as portas 80 e 443 livres ou não. A mensagem final ensina o túnel SSH e diz como apontar um domínio | `install/install.sh` (a decisão `exposure`) |
| Porta local | `3080`, ou a seguinte livre; `DESKVOICE_PANEL_PORT` escolhe outra. É a mesma do modo "80 e 443 de outro proxy", que já existia: um número só para documentar e para o túnel. A reinstalação mantém a porta que já estava publicada | `install/install.sh`, `pick_free_port` |
| Publicar por HTTP pelo IP | Só com `DESKVOICE_PANEL_PUBLIC_HTTP=yes`, ou respondendo "s" à pergunta do modo interativo, que nomeia o risco (a senha trafega sem criptografia) e tem "não" como resposta padrão | `install/install.sh` |
| Valores aceitos | `DESKVOICE_PANEL_LOCAL_ONLY` e `DESKVOICE_PANEL_PUBLIC_HTTP` aceitam **só `yes`**. `1`, `true`, `sim`, `no` e qualquer outro param a instalação com erro que diz o valor aceito, em todo modo e antes de gravar qualquer arquivo. Um valor só, porque cada sinônimo aceito é um caso a mais para testar, e a documentação já dizia `yes` | `install/install.sh` (início) |
| Opção sem efeito | Com domínio, as duas opções param com erro que nomeia a opção e o modo: com as portas livres o painel precisa ser alcançado de fora para o certificado; atrás de outro proxy ele já fica só em `127.0.0.1`. `DESKVOICE_PANEL_PORT` para do mesmo jeito quando o painel sai pelas portas 80/443. As duas opções juntas também | idem |
| Quem já instalou | Reinstalar e atualizar **não mudam a exposição**. Quem está publicado em HTTP continua, com um aviso em destaque e o comando para fechar (`DESKVOICE_PANEL_LOCAL_ONLY=yes bash install/install.sh`). Quem está local continua local, na mesma porta | `published_exposure` em `install/_common.sh`; `install/test/16-install-proves-entry.sh` |
| O endereço anunciado é o testado | O endereço da mensagem final é lido do `docker-compose.override.yml` gravado, o mesmo arquivo que o Compose publica e que a checagem de saúde sonda. Antes de anunciar, o instalador pede a rota de saúde pela porta publicada | `published_address`, `published_probe_url` em `install/_common.sh` |
| "Pronto" só depois de entrar | Com o dono recém-criado, o instalador faz login pela entrada única, confere que uma rota autenticada responde e sai. Login recusado para o dono recém-criado ou porta local sem resposta param a instalação com o que falhou; endereço de fora que ainda não abre (domínio) termina com zero e título próprio, sem dar o endereço como certo. Sem a senha em mãos (reinstalação), ele diz que não testou | `login_probe_js`, `try_login` em `install/_common.sh` |

### Como o login é provado sem expor a senha **[construtor]**

A sonda roda dentro do contêiner do painel e fala com o Caddy, pelo mesmo caminho da linha "Entrada única" da checagem de saúde. O e-mail e a senha chegam a ela pela **entrada padrão** (`docker compose exec -T`), como já acontecia na criação do dono: nada vai em argumento de processo, e nada é impresso. No instalador, a variável `DESKVOICE_OWNER_PASSWORD` é tirada do ambiente logo depois das perguntas; a senha fica numa variável não exportada, que nenhum processo filho herda, e é apagada depois da sonda. É uma tentativa só, porque o painel limita tentativas por e-mail; se o limite já estourou, o instalador diz que não testou e por quê. A sessão criada é encerrada na mesma sonda.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Aceitar `1`, `true` e `sim` como sinônimos de `yes` | Cada sinônimo é um valor a mais que precisa valer igual em todo modo, e o próximo defeito seria um sinônimo aceito num modo e não em outro. Recusar com a mensagem dizendo o valor aceito custa uma tentativa a quem errou |
| Mudar para local quem já está publicado em HTTP, na reinstalação ou na atualização | Tiraria do ar, sem aviso, o painel de quem o abre pelo IP (regra 7 do `GOVERNANCE.md`: quem já instalou não é surpreendido) |
| Certificado autoassinado no IP | O navegador mostra um alerta que ensina a pessoa a clicar em "continuar mesmo assim", e o microfone segue dependendo de exceção manual |
| Testar o login direto na porta do painel, sem passar pelo Caddy | Provaria o painel, e não o caminho de quem usa. A regra é conferir pelo endereço que vai ser anunciado |
| Testar o login com `curl`, de fora dos contêineres | O corpo precisa ser JSON, e montar JSON com uma senha arbitrária em shell é onde aspas e barras quebram. O `curl` fica com a conferência da porta publicada, que não leva segredo |

## Consequências

- Instalação nova sem domínio deixa de abrir pelo IP. Quem seguia um tutorial antigo vai encontrar `http://localhost:3080` e um comando de túnel no lugar de `http://<IP>`. Os três READMEs, o guia da primeira ligação, o `install/start.sh` e a skill de instalação dizem o padrão novo.
- A instalação com domínio cujo endereço de fora ainda não abre (o DNS ainda não aponta para a VPS, ou a VPS não alcança o próprio endereço público) **termina com código zero**, com um título próprio, "Instalado; o endereço ainda não abre", em vez de "Pronto". É o estado mais comum de quem instala com domínio pela primeira vez, e um código de erro ali faria um assistente conduzindo a instalação entender "quebrou" e tentar de novo. A mensagem não dá o endereço como certo: diz a causa provável, o que fazer e que não é preciso instalar de novo. O login é testado por dentro mesmo assim (a sonda fala com o Caddy pela rede interna, sem conferir certificado); se o certificado ainda não saiu e a sonda não chega à tela de entrada, vira aviso. Parar com erro fica para o defeito de verdade: a porta **local** sem resposta (nesse modo, a 80 desta máquina), o login recusado para o dono recém-criado, ou a sessão que não vale.
- O login recusado só é erro quando o dono foi criado nesta execução. Se o dono já estava no banco (reinstalação, ou instalação que estava parada), a senha das respostas pode não ser a dele: a recusa é aviso.
- O comando do túnel sai com o usuário preenchido (`SUDO_USER`, ou o usuário que rodou o instalador).
- A conferência da porta publicada é feita de dentro da própria VPS. Ela prova que o Compose publicou a porta e que o Caddy responde nela; não prova que o firewall do provedor deixa passar de fora. No modo aberto por HTTP a mensagem final diz isso.
- No modo "80 e 443 de outro proxy, com domínio", o endereço público depende de um passo de quem opera o proxy. O instalador confere até a porta local e diz que foi até ali.
- O job `install` do CI instala sem domínio: passa a exercitar o padrão local, lendo a porta do arquivo de publicação como já fazia.

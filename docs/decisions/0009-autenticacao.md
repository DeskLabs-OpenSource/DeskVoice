# 0009: Autenticação própria, por convite

- **Estado:** aceita
- **Data:** 2026-11-11
- **Quem decidiu:** o dono pediu "um bom sistema de auth, fácil de configurar para quem instala". As escolhas abaixo são do construtor e ficam abertas à revisão dele. Os itens marcados **[dono]** esperam decisão dele; cada um diz o que vale enquanto ela não vem.

## Contexto

Quem instala o DeskVoice não é programador e segue um vídeo. No DeskcommCRM, a autenticação dependia de um serviço externo e de um servidor de e-mail: a redefinição de senha apontava para `localhost` e falhava de forma genérica quando não havia e-mail configurado. Foi reclamação recorrente.

Na fundação, o DeskVoice nasceu com uma conta só, criada pelo instalador. O dono, ao usar, não achou como criar outra conta nem gerir a equipe.

## Decisão

Autenticação própria, dentro do Postgres da instalação, sem nenhum serviço externo. **Quem instala não configura nada para entrar.**

| Tema | O que vale | Onde está |
|---|---|---|
| Onde ficam as contas | No banco da instalação. Senha com `scrypt` | `packages/core/src/password.ts` |
| Sessão | Cookie `HttpOnly`, 30 dias, conferida no servidor a cada requisição. Só o resumo do token vai ao banco | `apps/panel/src/server/context.ts` |
| Primeira conta | Criada pelo instalador. A senha vai pela entrada padrão, nunca como argumento | `apps/routines/src/cli/create-owner.ts` |
| Como entra mais gente | **Por convite.** O dono ou um administrador gera um link, que aparece uma vez, vale 7 dias e serve uma vez. Não depende de e-mail | tela Equipe |
| Cadastro aberto | **Não existe.** O painel controla uma central telefônica; numa instalação exposta, qualquer pessoa criaria conta | — |
| Papéis | Dono, administrador e operador. Uma função só decide o papel; nenhuma rota compara à mão | `requireRole` em `apps/panel/src/server/context.ts` |
| Quem gere a equipe | Dono gere todos. Administrador gere administradores e operadores, e não mexe em dono. Operador não vê a tela | tela Equipe |
| Último dono | Sempre existe um dono ativo. Não dá para rebaixar, desativar nem remover o último | rotas de equipe |
| Sair da equipe | Desativar é a ação comum: encerra as sessões na hora e preserva o histórico de quem decidiu aprovações | tela Equipe |
| Trocar a própria senha | Pela tela, com a senha atual. Encerra as outras sessões | Configurações |
| Esqueci a senha | Redefinição de dentro do servidor, que encerra as sessões abertas da pessoa. Quem tem acesso à VPS já é dono da instalação | `bash install/reset-password.sh` |
| Tentativas de login | Três tetos, conferidos juntos antes da senha. **Par e-mail + endereço:** 5 falhas em 15 minutos bloqueiam aquele endereço para aquele e-mail, e o dono entra de outro lugar. **Endereço, qualquer e-mail:** 20 em 15 minutos, contra quem tenta muitas contas de um lugar só. **E-mail, qualquer endereço:** 50 em uma hora, contra quem distribui a tentativa por muitos endereços. Entrar com a senha certa zera o par e o e-mail. A resposta de bloqueio é a mesma para toda conta, e a de senha errada não revela se a conta existe, nem se está desativada | `apps/panel/src/app/api/v1/auth/login/route.ts` |
| Segredos de operador | Senha de linha e chave de IA cifradas em repouso, e nunca devolvidas pela API | `packages/core/src/secrets.ts` |

## O que não existe, e por quê

A Fábrica pede que a ausência seja uma linha escrita, e não um esquecimento.

| O que não existe | Por quê | O que vale hoje |
|---|---|---|
| "Esqueci a senha" por e-mail | Exigiria servidor de e-mail, que é a configuração que mais falhou no produto irmão | Redefinição de dentro do servidor. Recuperação por e-mail pode entrar como opção, ligada pela tela, para quem configurar o envio |
| Segundo fator **[dono]** | Não foi pedido, e cadastro mal feito de segundo fator tranca o dono para fora | Não há. Padrão enquanto o dono não decidir: fica fora desta versão e entra no roadmap como opcional, desligado de fábrica |
| Token de API de entrada **[dono]** | O produto ainda não tem API pública para terceiros | Não há. Padrão: nasce junto com a primeira integração que precisar dele (o conector com o DeskcommCRM) |
| Login com Google ou outro provedor | Exige cadastro num terceiro e configuração de endereço de retorno: é o oposto de "não configura nada" | Não há. Pode entrar como opcional |
| Várias empresas escolhidas no login **[dono]** | A tela opera uma organização por instalação (registro `0006`) | Não há. Decisão do dono, junto com a multiempresa na tela |
| Limite de login que sobrevive a reinício | O limite vive na memória do processo do painel | Reiniciar o painel zera a contagem. Está em "Limites conhecidos" |

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Serviço de autenticação externo | Mais uma conta, mais uma chave e mais um ponto de falha fora da VPS. Contraria "nada depende de terceiros para subir" |
| Cadastro aberto com aprovação do dono | Ainda deixa qualquer pessoa criar registro na instalação, e pede uma fila de aprovação que ninguém pediu |
| Convite por e-mail | Depende de servidor de e-mail. O link copiado resolve o mesmo problema sem configuração |
| Dono cria a conta e define a senha do outro | O dono saberia a senha de todo mundo |
| Bloquear por e-mail, 5 falhas em 15 minutos (o que valia até 12/11/2026) | Quem sabia o e-mail do dono o trancava fora, quantas vezes quisesse, de qualquer lugar (item 6.7 da régua da Fábrica: limite só por identificador é negação de serviço) |
| Só o par e o endereço, sem teto por e-mail | Quem tem muitos endereços tentaria 5 senhas por endereço a cada 15 minutos, sem fim. O teto por e-mail fecha isso, alto o bastante para não ser o que bloqueia no dia a dia |
| Teto por e-mail que segura a resposta (espera crescente no servidor) em vez de recusar | Cada pedido esperando prende uma conexão do painel: quem manda muitos de uma vez ocupa o servidor. Recusar na hora custa nada, e a janela de uma hora é a espera |
| Endereço com o mesmo teto do par (5) | O par nunca seria o que bloqueia, e uma pessoa errando a própria senha trancaria o escritório inteiro atrás do mesmo endereço, ou todo mundo que entra por túnel |

## Consequências

- Uma instalação nova fica utilizável por uma equipe sem configurar e-mail.
- Quem perde a senha depende de alguém com acesso ao servidor. Para o público do projeto, quem instalou costuma ser essa pessoa.
- O link de convite é uma credencial enquanto vale: quem o tiver cria a conta. Por isso vale sete dias, serve uma vez e pode ser revogado.
- Bloqueio por tentativas: quem erra a senha de alguém tranca só o próprio endereço para aquele e-mail. O dono, entrando de outro lugar, entra.
- Ainda dá para trancar o dono, de dois jeitos, e os dois estão em "Limites conhecidos" do `SECURITY.md`:
  - **Com muitos endereços:** 50 falhas na mesma hora contra um e-mail recusam esse e-mail de qualquer lugar até a mais antiga sair da janela de uma hora. Como cada endereço dá no máximo 20 falhas por hora a um e-mail (5 a cada 15 minutos), isso pede pelo menos 3 endereços errando a hora inteira, ou 10 de uma vez, e mantê-lo trancado pede continuar. Em IPv6, "endereço" é o bloco /64: quem tem uma VPS costuma receber um /64 inteiro, e contar o endereço inteiro daria a essa pessoa um endereço novo a cada tentativa, e o par nunca bloquearia ninguém com IPv6. IPv4 escrito como IPv6 (`::ffff:a.b.c.d`) conta como o IPv4. O mapa de tentativas é varrido a cada 256 reservas, e a chave cujo último registro saiu da maior janela é apagada: sem isso, quem troca de e-mail a cada pedido faria a memória do painel crescer sem teto. O número 50 é o equilíbrio escolhido: com ele, quem distribui consegue no máximo 50 tentativas por hora numa conta (1.200 por dia, contra 480 do limite antigo, para senhas de pelo menos 10 caracteres); mais alto deixaria adivinhar mais rápido, mais baixo deixaria trancar com menos endereços.
  - **Quando todo mundo chega com o mesmo endereço**, o par vira "e-mail" de novo, e o teto por endereço vira um teto da instalação inteira. É o caso do túnel SSH, o padrão sem domínio ([`0011`](0011-sem-dominio-o-painel-nao-vai-para-a-internet.md)): o Caddy vê o endereço da própria máquina para todo visitante, então 5 falhas num e-mail o bloqueiam para todos por 15 minutos, e 20 falhas em quaisquer contas bloqueiam a entrada de todos. Por túnel só chega quem tem acesso SSH à VPS. O mesmo vale para um proxy do operador que não repassa o endereço de quem chamou (`TRUSTED_PROXY_HOPS`, em `apps/panel/src/server/client-ip.ts`). Sem endereço confiável nenhum, não há teto por endereço e o par vale como "e-mail".
- A saída de emergência continua sendo a redefinição de dentro do servidor; a espera não passa de uma hora depois que as falhas param.

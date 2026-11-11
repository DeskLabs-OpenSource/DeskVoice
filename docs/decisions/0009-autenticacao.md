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
| Tentativas de login | Limite por e-mail e por endereço. A resposta não revela se a conta existe, nem se está desativada | `apps/panel/src/app/api/v1/auth/login/route.ts` |
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

## Consequências

- Uma instalação nova fica utilizável por uma equipe sem configurar e-mail.
- Quem perde a senha depende de alguém com acesso ao servidor. Para o público do projeto, quem instalou costuma ser essa pessoa.
- O link de convite é uma credencial enquanto vale: quem o tiver cria a conta. Por isso vale sete dias, serve uma vez e pode ser revogado.
- Bloqueio por tentativas: quem sabe o e-mail de alguém consegue trancá-lo por alguns minutos. Está em "Limites conhecidos"; a saída de emergência é a redefinição de dentro do servidor.

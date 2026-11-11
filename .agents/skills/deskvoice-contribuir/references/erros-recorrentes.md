# Erros recorrentes, e como cada um se evita aqui

Estes erros foram medidos no DeskcommCRM, o projeto irmão, ao longo de meses de triagem de PR. O
DeskVoice nasceu com uma regra para cada um. A coluna da direita é o que você faz.

| # | O erro no Deskcomm | Como ficou no DeskVoice | O que você faz |
|---|---|---|---|
| 1 | Migration com número sequencial: PRs paralelos disputavam o mesmo número (renumeradas 11 vezes em dois meses) | Nome com carimbo de tempo; cerca `migrations-are-timestamped-and-unique`; hook `pre-commit` | `db/migrations/$(date -u +%Y%m%dT%H%M%S)_o_que_muda.sql`. Colisão com PR aberto é trabalho dos mantenedores |
| 2 | Um segundo retrato do schema (baseline) que divergia das migrations | Um caminho só; o CI atualiza um banco da última versão, com dados | Nunca edite migration publicada. Migration nova precisa funcionar sobre banco que já tem dados: corrija os dados antes de criar a restrição |
| 3 | Peça nova registrada num arquivo-índice: todo PR colidia na mesma lista | Descoberta por pasta; cerca `one-file-per-piece` | Ferramenta, motor e rotina são um arquivo novo. Se você precisou editar uma lista, pare |
| 4 | Consulta que esquecia o filtro de empresa vazava dado entre empresas | `withOrg` é a única porta; cercas `no-raw-sql-outside-core` e `every-table-has-organization-id` | Use `ctx.q` ou `withOrg`. Tabela nova nasce com `organization_id uuid not null` |
| 5 | Recurso novo exigia variável de ambiente digitada na VPS e nascia quebrado em quem já usava | Cerca `env-vars-have-defaults` | Configuração de operador vai em `settings` e ganha tela. Variável nova só com padrão em `loadConfig` |
| 6 | Seção de versão escrita à mão no CHANGELOG quase publicou uma versão pelo merge de um PR | Fragmentos em `.changes/`; o número é calculado | Nunca toque no `CHANGELOG.md`. Escreva o fragmento, ou mande sem |
| 7 | PR aberto a partir da `main` do fork levava marca, `.env` e configuração da instalação da pessoa | Hook `pre-push`; pré-voo | `git switch -c fix/o-que-conserta origin/main` |
| 8 | Autor fechava o próprio PR achando que tinha errado o lugar (seis vezes, uma delas levando um conserto real) | Boas-vindas automáticas; modelo de PR | Não feche. Workflow parado no primeiro PR é o normal |
| 9 | PR bom ficava vermelho por causa alheia: teste com hora real, porta fixa, fuso, ou estado acumulado da `main` | Teste recebe `Clock` e porta `0`; check de PR mede só o diff; cada job diz de quem é a causa | Leia o resumo do job antes de "consertar". Não escreva teste que lê o relógio |
| 10 | Mudança de comportamento sem teste, ou com teste que não ficava vermelho sem o conserto | Prova por sabotagem no passo 5 | Sabote, conte os vermelhos, escreva no PR |
| 11 | Frase em português escrita direto no componente chegava à tela de quem usa em outro idioma | Cerca `ui-text-lives-in-dictionaries` | Texto de tela mora em `apps/panel/src/i18n/<idioma>/<feature>.ts`, nos três idiomas |
| 12 | Controle na tela que o motor ignorava (a tela gravava, ninguém lia) | Doutrina do sistema vivo: toda peça tem duas conexões | No PR, cite o arquivo que lê o que a sua tela grava |
| 13 | Segredo e dado pessoal real entraram no repositório | Varredura no hook e no CI | Dados inventados em teste e exemplo. Chave real vazou? Revogue primeiro |
| 14 | Commit assinado como `root@servidor`: o trabalho sumia do perfil de quem fez | Conferência no passo 8 | `git config user.email "<e-mail da sua conta>"` antes de commitar |
| 15 | Decisão de produto embutida em código (mudar regra para atender o próprio caso) | `GOVERNANCE.md` | Vira pergunta na issue, com o padrão que vale sem resposta |
| 16 | "Funciona na instalação nova" e quebrava em quem já tinha dados | Teste de atualização no job `db` | Pense em quem já instalou. Se precisa de ação, `impact: operator_action` e o bloco `## Requer atenção` |
| 17 | Rodar só um pedaço da suíte e chamar de verde | `pnpm verify` é a mesma sequência do CI | Rode `pnpm verify` inteiro e cole o rodapé |

## O que não é erro seu

- Workflows aguardando aprovação no primeiro PR.
- Job cancelado porque você empurrou de novo.
- Falha ao instalar dependências, baixar imagem base ou subir o banco do job.
- Fragmento faltando, conflito com a `main`, carimbo colidindo com PR aberto.

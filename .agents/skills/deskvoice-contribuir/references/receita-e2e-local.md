# Rodar na sua máquina o que o CI roda com banco e com tela

O `pnpm verify` roda sem nada além do Node e do pnpm. Esta página é para os outros três: os testes
de banco, a chamada simulada no terminal e os testes de tela. Os comandos são os do `package.json`
da raiz; se algo aqui divergir do `.github/workflows/ci.yml`, vale o workflow.

| Comando | O que roda | Precisa de | No CI |
|---|---|---|---|
| `pnpm test:db` | todos os `*.db.test.ts`, contra um Postgres com as migrations aplicadas | Docker, ou um Postgres 17 seu | job `db` |
| `pnpm demo` | uma chamada inteira com o motor simulado, e imprime a linha do tempo | o mesmo do `test:db` | job `simulated-call` (pelo teste `apps/voice/src/simulated-call.db.test.ts`) |
| `pnpm test:e2e` | os testes de tela de `apps/panel/test/e2e`, no Chromium | um painel no ar e o Chromium do Playwright | job `install`, contra a instalação que ele acabou de subir |

## Quando não dá para rodar

Não ter Docker, não ter onde subir um painel ou não ter tempo é normal. Não é motivo para não
abrir o PR. Diga no corpo do PR, na seção **Não medido**, qual comando você não rodou e por quê:
"não rodei `pnpm test:db`: sem Docker nesta máquina". O CI roda os três. O que não vale é marcar
como medido o que não foi.

## O banco de teste

### Com Docker (o caminho comum)

```bash
pnpm test:db
```

Sem nenhuma variável definida, o `test:db` sobe um Postgres 17 descartável num contêiner, aplica
as migrations, roda os testes e remove o contêiner no fim (`scripts/test-db-setup.ts`). Cada
execução usa um nome de contêiner próprio, então duas suítes ao mesmo tempo não colidem.

Um arquivo só: `pnpm vitest run --project db <caminho>.db.test.ts`.

### Um banco que fica de pé entre execuções

Subir o contêiner a cada rodada custa segundos. Para repetir muitas vezes:

```bash
pnpm db:test:up                      # imprime a URL do dono, numa porta livre
export TEST_DATABASE_URL=<a URL que ele imprimiu>
pnpm test:db                         # quantas vezes quiser
pnpm db:test:down                    # no fim
```

Com só `TEST_DATABASE_URL` definida, ela é tratada como a URL do **dono** do banco: os papéis
`deskvoice_app` e `deskvoice_system` ganham senha de teste e as outras duas URLs
(`TEST_SYSTEM_DATABASE_URL` e `TEST_MIGRATION_DATABASE_URL`) são derivadas dela. Definir as três
de uma vez faz o setup usá-las como estão.

### Sem Docker

O `TEST_DATABASE_URL` também aceita um Postgres 17 seu, desde que seja descartável: as migrations
rodam nele, e os testes criam e apagam dados. Suba um numa pasta temporária (os comandos estão no
passo 1 do painel descartável, abaixo), crie um banco vazio e aponte para ele:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/<banco> pnpm test:db
```

Nunca aponte para o banco de uma instalação em uso.

## A chamada simulada no terminal

```bash
pnpm demo
```

Sobe o mesmo banco descartável do `test:db` (e respeita o `TEST_DATABASE_URL` do mesmo jeito),
atende uma chamada com o motor simulado, sem tronco, sem chave de IA e sem Asterisk, e imprime a
linha do tempo que o painel mostraria. Serve para ver o caminho de uma chamada de ponta a ponta
quando você mexeu nele. Quem cobra esse caminho no CI é o teste
`apps/voice/src/simulated-call.db.test.ts`:
`pnpm vitest run --project db apps/voice/src/simulated-call.db.test.ts`.

## Os testes de tela

`apps/panel/test/e2e` guarda os caminhos de primeira impressão: entrar, configurar, simular uma
chamada, convidar alguém e as confirmações antes de apagar. Eles **não sobem nada**: apontam para
um painel no ar e criam dados nele. Nunca use uma instalação em uso.

As três variáveis são as de `apps/panel/test/e2e/playwright.config.ts`:

- `DESKVOICE_E2E_URL`: endereço do painel (padrão `http://127.0.0.1:3080`);
- `DESKVOICE_E2E_EMAIL` e `DESKVOICE_E2E_PASSWORD`: o dono. Sempre por variável, nunca no arquivo.

E o Chromium do Playwright, uma vez por máquina:

```bash
pnpm --filter ./apps/panel exec playwright install --only-shell chromium
```

### Um painel descartável, sem Docker

Postgres 17 do Homebrew; tudo numa pasta temporária; portas e segredos são seus, inventados na
hora.

1. `initdb -D <tmp>/pg -U postgres --auth=trust --no-locale`, acrescente `lc_messages = 'C'` ao
   `postgresql.conf`, suba com `pg_ctl -D <tmp>/pg -o "-p <porta> -k '' -c listen_addresses=127.0.0.1" start`
   e crie o banco com `createdb`.
2. Migrations e papéis: `MIGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/<banco>`,
   `APP_DB_PASSWORD` e `SYSTEM_DB_PASSWORD` definidas, `pnpm --filter @deskvoice/routines run migrate`.
3. As variáveis do produto: `DATABASE_URL` e `SYSTEM_DATABASE_URL` com os papéis `deskvoice_app` e
   `deskvoice_system`, `DESKVOICE_SECRET_KEY` (`openssl rand -hex 32`), `ARI_PASSWORD`,
   `INTERNAL_TOKEN`, `WAHA_API_KEY` (qualquer valor: sem ela o bloco de WhatsApp mostra outro
   estado), `PUBLIC_URL` e `VOICE_INTERNAL_URL`, `VOICE_INTERNAL_PORT`, `VOICE_WEB_PORT`,
   `AUDIOSOCKET_PORT` em portas livres e `ASTERISK_TRUNKS_FILE` na pasta temporária.
4. O dono: `printf '%s' "$DESKVOICE_E2E_PASSWORD" | pnpm --filter @deskvoice/routines run create-owner -- --email "$DESKVOICE_E2E_EMAIL" --name "Pessoa" --organization "Empresa" --password-stdin`.
5. A voz: `pnpm --filter @deskvoice/voice start` (sem Asterisk ela fica tentando a conexão, e a
   chamada simulada funciona assim mesmo).
6. O painel **construído**: `pnpm --filter ./apps/panel build`, e na pasta `apps/panel`,
   `npx next start -H 127.0.0.1 -p <porta>`. Com `next dev` as páginas recarregaram sozinhas em
   laço em 2026-11-12, e os testes falharam por isso, não pelo painel.
7. Uma vez por máquina: `pnpm --filter ./apps/panel exec playwright install --only-shell chromium`.
8. `DESKVOICE_E2E_URL=http://127.0.0.1:<porta> pnpm test:e2e`, com `DESKVOICE_E2E_EMAIL` e
   `DESKVOICE_E2E_PASSWORD` do passo 4.

Pare tudo ao terminar (`pg_ctl -D <tmp>/pg stop`) e apague a pasta temporária.

### Quando um teste de tela falha

- O rastro de cada passo fica em `apps/panel/test/e2e/test-results/`:
  `pnpm --filter ./apps/panel exec playwright show-trace <arquivo>`.
- No CI, baixe o artefato `testes-de-tela` do job `install`: relatório e rastro de cada passo, com
  a tela.
- O teste de Configurações supõe uma instalação feita pelo instalador, que sempre gera a
  `WAHA_API_KEY`: contra um painel sem essa chave, o bloco WhatsApp aparece como "indisponível", e
  não "não instalado", e o teste falha.

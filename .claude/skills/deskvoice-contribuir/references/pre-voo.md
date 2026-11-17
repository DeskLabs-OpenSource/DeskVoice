# O pré-voo, item a item

O `scripts/preflight.sh` mede; esta página diz por que cada item existe e o que fazer quando ele
acusa. Os itens e os números são os do script, na ordem em que ele imprime. Se o script e esta
página divergirem, vale o script: ele é o que roda.

```bash
git fetch origin            # num fork: git fetch upstream
bash .agents/skills/deskvoice-contribuir/scripts/preflight.sh
```

O pré-voo **só mede**: não altera nada e sai sempre com 0. Cada linha começa com `ok`, `ATENÇÃO`
ou `-` (informação), e a linha `$ …` logo abaixo é o comando para você conferir sem confiar nele.

## Antes dos itens: contra o quê ele mede

O script compara o seu ramo com `upstream/main`, se ela existe no clone, e com `origin/main`, se
não. Num fork, `origin` é o seu fork e a `main` dele costuma estar parada; a régua é a `main` do
repositório principal.

| Saída | O que quer dizer | O que fazer |
|---|---|---|
| `NÃO MEDIDO: rode de dentro de um clone do DeskVoice.` | o diretório atual não é um repositório git | `cd` para o clone |
| `NÃO MEDIDO: não existe origin/main neste clone.` (ou `upstream/main`) | o remoto nunca foi baixado | `git fetch origin` (ou `upstream`) |
| `NÃO MEDIDO: este ramo não tem ancestral comum com …` | o ramo nasceu de outro histórico | recomece de `git switch -c <ramo> origin/main` e traga o trabalho |

Nenhum desses casos mede nada. Não trate como "passou".

## 1. Ramo

- **`você está em 'main'`.** PR sai de um ramo com nome. A `main` do fork carrega o que é da sua
  instalação, e um PR aberto dali propõe tudo isso ao projeto. `git switch -c fix/o-que-conserta`.
- **`N commit(s) atrás de origin/main`.** O CI mede a prévia do merge com a `main` do momento do seu
  último push, e não mede de novo quando a `main` anda: um verde antigo não prova o que vai entrar,
  e com conflito ele nem roda. `git merge origin/main`; nunca `reset --hard` nem
  `push --force`.
- **`arquivos que a main também mudou`.** É onde o conflito vai nascer. Mescle agora. Num conflito,
  leia os dois lados: a resposta certa costuma ser a combinação, não um lado só. Depois do merge,
  `pnpm verify` de novo e commite a resolução.

## 2. Segredo no diff

O pré-voo olha **tudo o que o PR proporia**: os commits do ramo e o que ainda não foi commitado
(fixtures de cerca ficam de fora, porque são exemplos ruins de propósito).

- **`linha(s) nova(s) com formato de segredo`.** Chave privada, chave de nuvem, chave de IA, token
  do GitHub ou do Slack. Se é chave de verdade, **revogue-a no provedor antes de qualquer outra
  coisa**: histórico de git não esquece, e apagar no commit seguinte não adianta. Se é exemplo,
  troque por um valor sem formato de chave (`"chave-de-exemplo"`). Chave de operador mora no
  banco, cifrada, e entra pela tela.
- **`o gitleaks achou algo nos commits do ramo`.** É o que o job `secrets` do CI roda; ele vai
  reprovar. Rode o comando impresso para ver onde. Sem `gitleaks` instalado, a linha diz isso e o
  CI faz a varredura completa.
- **`arquivo de ambiente no diff`.** O `.env` guarda segredo gerado pelo instalador e nunca entra
  no repositório; `.env.example` pode. `git rm --cached <arquivo>`.

O hook `pre-commit` recusa os mesmos formatos e o `.env` no momento do commit
([Passo 2](../SKILL.md#passo-2-arme-os-hooks-uma-vez-por-clone)). O pré-voo existe para quem não
armou os hooks, ou commitou antes de armar.

## 3. `console.log`

**`linha(s) nova(s) com console.*`.** O `pnpm lint` reprova. O que acontece numa chamada vira
evento na linha do tempo (`recordEvent`), que é o que quem opera vê; script de linha de comando
escreve com `process.stdout.write`.

## 4. Variável de ambiente nova

**`variável(is) fora de fences/env-allowlist.ts`.** Recurso não se liga por `.env`: quem opera não
tem SSH, e configuração de operador mora em `settings`, com tela. Variável de ambiente é só para o
que a instalação precisa para subir (endereço do banco, porta, segredo gerado pelo instalador), e
tem padrão. Se é esse o caso, ela entra em `fences/env-allowlist.ts` com a marca `generated` (o
instalador gera) ou `default` (a instalação sobe sem ela), e a cerca `env-vars-have-defaults`
reprova qualquer outra. Se é configuração de operador, o caminho é a tela; a
regra e o porquê estão na skill `deskvoice-doutrina`.

O pré-voo só procura `env.NOME`, `env?.NOME` e `env["NOME"]` em linhas novas de `apps/` e
`packages/`. Outra forma de ler o ambiente passa por ele sem aviso; a cerca pega no `pnpm fences`.

## 5. Migration

Migration fica em `db/migrations/AAAAMMDDTHHMMSS_slug.sql`, com carimbo de tempo e sem baseline.

- **`já está publicada na main`.** Migration publicada nunca é editada, renomeada ou apagada: quem
  já instalou rodou a versão antiga e não roda de novo. Desfaça e corrija com uma migration nova,
  só para frente.
- **`fora do padrão AAAAMMDDTHHMMSS_slug.sql`.** Slug em minúsculas, números e `_`.
  `git mv <arquivo> "db/migrations/$(date -u +%Y%m%dT%H%M%S)_o_que_muda.sql"`.
- **`usa um carimbo que já existe na main`.** Duas migrations com o mesmo carimbo têm ordem
  indefinida. Gere outro com `date -u +%Y%m%dT%H%M%S`.
- **`ok … (nome e carimbo livres na main …)`.** O pré-voo só compara com a `main`. Colisão com
  outro PR aberto é trabalho dos mantenedores na hora do merge.

Migration nova também pede `organization_id` em tabela nova (cerca
`every-table-has-organization-id`) e `pnpm test:db` verde. Como rodar o banco de teste:
[`receita-e2e-local.md`](receita-e2e-local.md).

## 6. Notas de versão

- **`CHANGELOG.md editado à mão`.** Ele é montado dos fragmentos na hora da versão. Desfaça a
  edição e escreva `.changes/<slug>.md`
  ([Passo 7](../SKILL.md#passo-7-o-fragmento-de-versão-não-o-changelog)).
- **`o diff toca o produto e não traz fragmento`.** O diff mexe em `packages/`, `apps/`, `db/`,
  `install/` ou `deploy/`. Se quem opera uma instalação percebe a mudança, escreva o fragmento. Se
  não souber, mande sem: o fragmento que falta é trabalho dos mantenedores.
- **`fragmento presente`.** Confira o formato com `pnpm release:check`.

## 7. Skills

- **`.claude/skills é espelho gerado`.** O diff mexe em `.claude/skills` e não na fonte. Edite
  `.agents/skills` e rode `pnpm skills:sync`; a cerca `skills-mirror-is-in-sync` reprova o espelho
  que diverge.
- **`skill alterada: rode pnpm skills:sync antes de commitar`.** Lembrete: o espelho vai no mesmo
  commit. Skill nova também precisa de `agents/openai.yaml` (cerca `skills-have-codex-manifest`)
  e de uma linha nas tabelas de skills do `AGENTS.md`, de `.cursor/rules/deskvoice-guias.mdc` e de
  `.agents/rules/deskvoice-guias.md`.

## Depois do pré-voo

O pré-voo não roda teste nenhum. A última linha manda rodar o que o CI roda:

```bash
pnpm verify      # lint, tipos, cercas, testes de unidade
pnpm test:db     # se tocou em banco (pede Docker)
```

O que cada um precisa e o que fazer quando não dá para rodar: [`receita-e2e-local.md`](receita-e2e-local.md).
O que o pré-voo não vê, e só a revisão vê: o teste que fica vermelho sem a mudança (Passo 5), a
prova em tela (Passo 6) e as regras de produto do [`GOVERNANCE.md`](../../../../GOVERNANCE.md).

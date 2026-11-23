# Doutrina das cercas

> Lei sobre **as regras que a máquina cobra**: o que é uma cerca, quem responde por ela, quando
> ela é revista e o que ela tem permissão de medir.

## O que é uma cerca

Uma cerca é um teste que guarda uma **regra de forma** do repositório, e não um comportamento do
produto. Um teste comum pergunta "esta função devolve o valor certo?". Uma cerca pergunta "toda
tabela tem organização?", "existe variável de ambiente sem padrão?", "algum documento aponta
para um arquivo que não existe?".

As cercas moram em `fences/`, uma por arquivo, e rodam com `pnpm fences`. Fazem parte do
`pnpm verify` e do CI.

Cerca boa é a que transforma uma regra que dependia de alguém lembrar em uma regra que não
depende de ninguém.

## Toda cerca tem dono, motivo e data de revisão

Cada arquivo de cerca abre com um cabeçalho de três campos:

- **dono:** quem responde quando ela reprova por engano, e quem decide se ela ainda vale;
- **motivo:** o erro que ela impede, em uma frase que faça sentido para quem nunca viu o erro;
- **revisar em:** a data em que alguém confere se o motivo ainda existe.

### Por quê

No DeskcommCRM, travas sobreviviam ao motivo que as criou. Uma regra nascia para impedir um erro
real, o código em volta mudava, o erro deixava de ser possível, e a trava continuava reprovando
PR. Ninguém a removia, porque ninguém sabia mais por que ela existia nem de quem era.

Uma cerca sem motivo escrito não pode ser removida com segurança. E o que não pode ser removido
só se acumula.

### A revisão

Chegada a data, o dono escolhe uma de três saídas e registra no próprio cabeçalho:

| Situação | Saída |
|---|---|
| O motivo continua valendo | Nova data de revisão |
| O motivo mudou | Reescreve a cerca e o motivo |
| O motivo acabou | Apaga a cerca |

Apagar uma cerca que perdeu o motivo é manutenção, não descuido.

## Check de PR só mede o diff

Esta é a regra que protege quem contribui.

> **O check de um PR só pode ficar vermelho por causa do que o PR mudou.**

O erro medido no DeskcommCRM: PRs bons ficavam vermelhos por causa alheia. Um arquivo que outra
pessoa quebrou, um teste que dependia do relógio, um limite acumulado que estourou com a soma de
vários PRs. O contribuidor via o vermelho, não sabia se era culpa dele e desistia, ou gastava
horas consertando o que não tinha quebrado.

A regra tem três consequências práticas:

1. **Estado acumulado é check da `main`.** Tudo o que mede o repositório inteiro, como tamanho
   total ou soma de avisos, roda na `main`. Se ficar vermelho, é trabalho dos mantenedores, e
   não bloqueia PR de ninguém.
2. **A mensagem diz de quem é a culpa.** Cada job do CI termina dizendo se a causa está no PR ou
   fora dele.
3. **Teste não depende do ambiente.** Sem relógio real, sem porta fixa, sem fuso da máquina. O
   teste recebe um relógio e abre a porta `0`. Teste que falha de vez em quando é defeito do
   teste, e se conserta antes de qualquer outra coisa.

## As cercas da fundação

| Cerca | O que guarda |
|---|---|
| `every-table-has-organization-id` | Toda tabela pertence a uma organização. Veja [isolamento](isolamento.md) |
| `migrations-are-timestamped-and-unique` | Nome de migration é carimbo de tempo, sem repetição. Veja [um caminho de schema](um-caminho-de-schema.md) |
| `env-vars-have-defaults` | Nenhuma variável de ambiente sem padrão ou sem ser gerada pelo instalador |
| `no-raw-sql-outside-core` | SQL só dentro de `packages/core` |
| `no-conflict-markers` | Nenhum marcador de conflito esquecido |
| `workflows-declare-permissions` | Todo workflow declara as permissões que usa |
| `skills-mirror-is-in-sync` | O espelho `.claude/skills` corresponde a `.agents/skills` |
| `docs-point-to-existing-files` | Documento não aponta para arquivo que não existe |
| `fences-have-owner-and-review-date` | Toda cerca tem dono, motivo e data de revisão |
| `ui-text-lives-in-dictionaries` | Texto de tela só em dicionário |
| `release-fragments-are-valid` | Fragmento de versão bem formado. Veja [versionamento](versionamento.md) |
| `released-fragments-do-not-return` | Fragmento que uma versão já publicou e apagou não volta para `.changes/` (o título já está no `CHANGELOG.md`) |
| `one-file-per-piece` | Nenhum arquivo-índice nas pastas de ferramentas, motores e rotinas. Veja [um arquivo por peça](um-arquivo-por-peca.md) |
| `workflows-cancel-superseded-runs` | Um run de CI por PR: o novo cancela o anterior |
| `welcome-does-not-checkout` | O workflow de acolhida, que roda com permissão do repositório, nunca baixa código de fork |
| `partner-address-has-one-spelling` | Todo endereço do domínio da parceira é o de `install/partner.env`, e ele está no `AGENTS.md` e na skill de instalar |
| `third-party-images-are-pinned` | Toda imagem de terceiros está fixada por resumo: no Compose de produção (banco, Asterisk, Caddy), na base de cada `Dockerfile` (`FROM`) e nos `services` e `container` dos jobs do CI |
| `image-name-has-one-source` | O endereço das imagens só está em `deploy/images.env`; o Compose, o kit e a publicação leem dali. A versão de uma instalação é um número, nunca um canal |
| `every-workspace-is-typechecked` | O `pnpm typecheck` da raiz confere os tipos de todo pacote, testes incluídos: o `tsconfig.json` da raiz inclui o `src` dele, ou o script da raiz chama o `typecheck` dele (o do painel, que a raiz exclui) |

A lista acima é um retrato da fundação. A verdade é a pasta `fences/`.

## Quando criar uma cerca

Crie quando as três condições valem:

1. O erro **já aconteceu**, aqui ou no DeskcommCRM. Cerca para erro imaginado é ruído.
2. A regra é **mecânica**: dá para decidir olhando os arquivos, sem julgamento.
3. A mensagem de reprovação consegue dizer **o que fazer**, e não só o que está errado.

Se a regra pede julgamento, ela não é cerca. Ela vai para a lista "o que o CI não vê" do
[`AGENTS.md`](../../AGENTS.md), e é cobrada na revisão.

## Cerca que falha de vez em quando

Cerca que reprova sozinha, sem ninguém tocar no repositório, é defeito da cerca — e se conserta
antes de qualquer outra coisa. O difícil é que ela não deixa rastro: a rodada vermelha passa, a
seguinte fica verde, e ninguém sabe qual teste caiu.

Por isso falha intermitente se **captura**, não se adivinha. `scripts/fence-soak.sh` roda as cercas
em laço — 40 rodadas por padrão — com um comando pesado em paralelo, e guarda a saída inteira de
cada rodada vermelha:

```bash
bash scripts/fence-soak.sh            # 40 rodadas com pnpm typecheck em paralelo
bash scripts/fence-soak.sh 120        # taxa de falha baixa pede laço maior
```

O que ele deixa em `${TMPDIR:-/tmp}/fence-soak/<carimbo>/`:

| arquivo | o que tem |
|---|---|
| `falhas/rodada-N.log` | a saída verbosa da rodada vermelha, com o nome do teste; é o que se anexa na issue |
| `falhas/rodada-N.ambiente.txt` | load, memória, HEAD, árvore suja e os processos pesados daquele momento |
| `resumo.txt` | rodadas, falhas e tempos (mínimo, mediana, máximo) |

Medido em 4 vCPU com o typecheck em paralelo: cerca de 4 s por rodada, 120 rodadas em 11 minutos.
A saída fica fora do repositório de propósito — as cercas que varrem a árvore inteira leriam o
próprio log da rodada anterior.

O laço **não** é do CI: o CI roda as cercas uma vez, dentro de `pnpm verify`. Quarenta rodadas
existem para caçar a falha rara na máquina de quem está investigando.

Intermitência não se conserta aumentando `testTimeout` nem marcando o teste como `skip`: os dois
escondem o sintoma e devolvem a cerca vermelha para a máquina de outra pessoa. Com o nome do teste
e a saída guardada, a causa costuma ser uma entre poucas — relógio, porta, arquivo temporário,
ordem de execução, ou uma árvore que outro processo está mudando — e aí sim se conserta, com prova
de sabotagem.

## Quando uma cerca reprova o seu PR

1. Leia a mensagem. Ela diz o que fazer.
2. Se a cerca estiver errada, ou reprovando algo que você não tocou, diga no PR e marque o dono
   dela. Isso é defeito da cerca, e consertá-la não é trabalho seu.
3. Não contorne. Exceção a uma cerca é decisão do dono dela, e fica escrita, com motivo e data
   de revisão, como a própria cerca.

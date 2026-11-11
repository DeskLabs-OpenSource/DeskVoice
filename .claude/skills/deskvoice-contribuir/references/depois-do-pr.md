# Depois de abrir o PR

## O que vai parecer erro e não é

- **Nenhum check aparece.** No primeiro PR de quem nunca contribuiu aqui, o GitHub segura os
  workflows até um mantenedor liberar. Não é erro seu e não há o que fazer além de esperar.
- **Um robô comentou.** A mensagem de boas-vindas é automática e fala do processo, não do seu PR.
- **Prazo.** Uma pessoa responde em até 3 dias úteis.

## O único check que importa

A proteção da `main` exige um check só: **`ready`**. Ele passa quando todos os jobs que o seu diff
precisava rodar passaram. Job "skipped" não é problema: o job `changes` decide por caminho
alterado o que roda (um PR só de documentação não sobe banco nem constrói imagem).

```bash
gh pr checks <número>            # todos
gh pr checks <número> --watch    # acompanha até terminar
gh run view <id-do-run> --log-failed
```

## Como ler um CI vermelho

1. Abra o job vermelho (não o `ready`: ele só agrega).
2. Leia o **resumo do job** (aba Summary). Todo job termina com uma frase dizendo se a causa
   provável é **esta mudança** ou **da casa**, e o que fazer.
3. Leia o log do **passo** que falhou, não só a última linha.

| Job | Roda | Reproduzir na sua máquina |
|---|---|---|
| `verify` | sempre | `pnpm verify` |
| `secrets` | sempre | `gitleaks git --redact --log-opts="$(git merge-base origin/main HEAD)..HEAD" .` |
| `db` | diff toca código | `pnpm test:db` (sobe e remove sozinho um Postgres descartável; pede Docker) |
| `simulated-call` | diff toca código | `pnpm vitest run --project unit apps/voice` |
| `build` | diff toca código | `pnpm --filter ./apps/panel build` |
| `images` | diff toca código de imagem | `docker build --target panel .` (e `voice`, `routines`) |
| `install` | diff toca instalador, deploy ou migrations | `bash install/test/run.sh` |

**Causa da casa** (você não conserta nada): falha ao instalar dependências, ao baixar imagem base
ou ao subir o Postgres do job; job cancelado porque você empurrou de novo (um run por PR: o novo
cancela o anterior). Comente no PR pedindo a reexecução.

**Causa da mudança**: lint, tipos, cerca ou teste vermelho. A mensagem da cerca diz o conserto.

**O `secrets` ficou vermelho**: se a chave é real, **revogue-a no provedor antes de qualquer outra
coisa**. Ela já está pública, e apagar o commit não a recolhe. Depois avise no PR; os mantenedores
ajudam a limpar o histórico do ramo.

**Cerca vencida** (`fences-have-owner-and-review-date`): em PR ela só avisa. Vencimento é
problema da `main`, não seu.

## O que é trabalho dos mantenedores

| | |
|---|---|
| **Fragmento em `.changes/`** | Se faltar, nós escrevemos, com o seu crédito |
| **Conflito com a `main`** | Nós resolvemos, preservando os seus commits. Pode chegar um merge da `main` no seu ramo: `git pull --no-rebase` antes do próximo push |
| **Carimbo de migration** | Se colidir com outro PR aberto, nós renomeamos |
| **Fila de merge** | Depois de aprovado, o PR entra numa fila que o testa sobre a `main` do momento. Se cair da fila por conflito com outro PR, nós recolocamos |
| **Liberar workflows do primeiro PR** | Um mantenedor libera |

## Pediram mudança

Empurre commits novos no mesmo ramo. Não feche e reabra, não force o push: a revisão perde o fio.
Responda cada comentário dizendo o que fez ou por que não fez.

# Doutrina de um caminho de schema

> Lei sobre **como o banco chega ao formato atual**: por um caminho só. Instalar é aplicar todas
> as migrations em ordem. Atualizar é aplicar as que faltam. Não existe baseline separado.

## O princípio-raiz

> **"O banco de quem instalou hoje é igual ao banco de quem instalou há seis meses e vem
> atualizando?"**

Só existe uma forma de responder "sim" com certeza: os dois bancos terem passado pelo mesmo
caminho.

## O erro que originou a regra

O DeskcommCRM tinha dois retratos do schema: as migrations, usadas no desenvolvimento, e um
arquivo de baseline, aplicado na instalação. Cada mudança de banco precisava sair nos dois. Eles
divergiram. Uma migration que não chegava ao baseline não chegava a quem instalava numa VPS, e
nenhum teste percebia, porque cada caminho passava sozinho.

Dois retratos do mesmo schema só ficam iguais enquanto alguém lembra de atualizar os dois.

## A lei

1. **Um caminho.** O schema é o resultado de aplicar, em ordem, todos os arquivos de
   `db/migrations`. Não há outro arquivo que descreva o banco.
2. **Nome com carimbo de tempo.** `<AAAAMMDDTHHMMSS>_<slug>.sql`. Nunca número sequencial: dois
   PRs paralelos escolheriam o mesmo número.
3. **Só para frente.** Não há migration de volta. Desfazer é escrever uma migration nova.
4. **Publicada, nunca editada.** O executor guarda o hash de cada migration aplicada e recusa
   uma que tenha mudado depois. Errou? Corrija com outra migration.
5. **Aplicar duas vezes não muda nada.** O executor registra o que já aplicou e só roda o que
   falta.
6. **Toda tabela nasce com `organization_id uuid not null`**, exceto `organizations` e
   `schema_migrations`. O porquê está na [doutrina de isolamento](isolamento.md).

## A régua para o contribuidor

| Você quer | Faça |
|---|---|
| Criar tabela ou coluna | Um arquivo novo em `db/migrations`, com o carimbo da hora em que escreveu |
| Corrigir uma migration que já entrou na `main` | Uma migration nova. Não edite a antiga |
| Corrigir uma migration do seu PR ainda aberto | Edite à vontade. Ela ainda não foi publicada |
| Renomear o carimbo porque outra migration entrou antes | Nada. O ajuste é feito na fila de merge, por um mantenedor |
| Apagar coluna ou tabela | Migration nova, e diga no PR o que quem já instalou perde. Veja a [doutrina de versionamento](versionamento.md) |

## Como a regra é cobrada

- **Cerca de carimbo:** reprova migration fora do padrão de nome ou com carimbo repetido.
- **Cerca de organização:** reprova tabela sem `organization_id`.
- **Teste do executor:** aplicar duas vezes é idempotente, e migration alterada depois de
  aplicada é recusada.
- **CI, nos dois sentidos:** uma instalação nova aplica tudo do zero, e uma instalação da
  última versão publicada, com dados, é atualizada até o estado do PR. Se os dois não chegarem
  ao mesmo lugar, o PR não entra.

## O que o CI não vê

- **Migration lenta em banco grande.** O banco do teste é pequeno. Se a sua migration reescreve
  uma tabela inteira, diga no PR.
- **Dado que deixa de fazer sentido.** Uma coluna nova com valor padrão errado para as linhas
  antigas passa em todo teste e quebra a instalação de alguém.

## Documentos relacionados

- [Decisão 0005](../decisions/0005-um-caminho-de-schema.md): as alternativas descartadas.
- [Decisão 0003](../decisions/0003-postgres-na-vps.md): por que o banco mora na VPS.
- [`um-arquivo-por-peca.md`](um-arquivo-por-peca.md): a mesma ideia fora do banco.

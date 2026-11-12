# 0006: Organização desde o primeiro dia

- **Estado:** aceita
- **Data:** 2026-11-10
- **Quem decidiu:** construtor da fundação, a partir de erro medido no DeskcommCRM

## Contexto

A fundação do DeskVoice opera **uma empresa por instalação** na tela. Operar várias empresas na
mesma tela está fora do escopo.

Isso sugere um atalho: se só há uma empresa, as tabelas não precisam saber de quem é cada linha.

Dois fatos pesam contra o atalho:

- No DeskcommCRM, **o isolamento entre empresas foi furado**. A proteção dependia de cada trecho
  de código lembrar de filtrar, e o teste cobria uma lista fixa de tabelas.
- Implementadores, que são parte central do público do projeto, atendem vários clientes. O
  pedido para operar mais de uma empresa vai chegar.

## Decisão

O banco nasce com **organização em tudo**, mesmo com a tela operando uma só:

- Toda tabela tem `organization_id uuid not null`. As exceções são `organizations` e
  `schema_migrations`.
- Todo acesso a dado de produto passa por uma única camada, `withOrg`.
- Um teste de isolamento é **gerado para toda tabela**, a partir do catálogo do banco. Tabela
  nova entra no teste sem que ninguém precise lembrar.

A lei completa está na [doutrina de isolamento](../doctrine/isolamento.md).

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Sem organização agora, acrescentar quando for preciso | É a migração mais cara que existe: toda tabela, toda consulta e todo teste mudam juntos, com dados de produção no meio. E o período de transição é exatamente quando o isolamento fura |
| Uma instalação por empresa, para sempre | Serve para muitos casos e continua possível. Como única opção, obriga o implementador a manter uma VPS por cliente, e fecha a porta para uma tela de vários clientes |
| Organização nas tabelas, com filtro escrito em cada consulta | É o desenho que furou no Deskcomm. Proteção que depende de memória falha |
| Um banco ou um schema por organização | Isola bem e multiplica o custo de migration, de backup e de conexão. Não cabe numa VPS pequena |

## Consequências

**Boas:**

- Operar várias empresas na mesma tela, quando chegar, é trabalho de tela, e não de banco.
- O isolamento é cobrado por máquina desde a primeira tabela.
- Dado de chamada, que é sensível, nunca existe sem dono.

**Custos:**

- **Toda tabela carrega uma coluna que hoje tem um valor só.** O custo é pequeno e permanente.
- **Todo acesso passa pela camada**, mesmo quando pareceria mais simples consultar direto. A
  cerca reprova o atalho.
- **As poucas operações que atravessam organizações** (entrar, reivindicar tarefa, achar o dono
  de um número chamado) precisam de porta própria, revisada com cuidado.
- **A rota pública de saúde soma as organizações, sem detalhe** (2026-11-12, item 7.8 da medição
  de [12/11](../fundacao/conformidade-2026-11-12.md)). O instalador e o `install/healthcheck.sh`
  leem a rota sem sessão, e precisam saber se a instalação tem chave de motor e se algum teste de
  chave falhou. Sem sessão, a linha do motor diz só o estado da soma (`engine_key_problem`, ou
  `engine_ok`), sem provedor, modelo nem data, que são de uma organização. Com sessão, chave e teste
  são lidos só da organização da sessão, por `withOrg`. A linha da operadora continua somada e com
  a contagem de linhas caídas, que é a outra metade do item 7.8, ainda aberta.

## Nota sobre a outra "organização"

O repositório também nasceu numa organização do GitHub, `DeskLabs-OpenSource`, e não numa conta
pessoal. É outra decisão, do dono do projeto, com motivo próprio: no DeskcommCRM, a fila de CI
entupia no teto da conta pessoal. Ela está registrada no
[desenho da fundação](../specs/2026-11-10-fundacao-design.md) e, na prática, no
[`GOVERNANCE.md`](../../GOVERNANCE.md).

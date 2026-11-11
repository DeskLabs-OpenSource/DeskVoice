# Doutrina de isolamento

> Lei sobre **de quem é cada dado**: todo dado de produto pertence a uma organização, e só se
> chega a ele por uma camada que sabe disso. Uma camada só, e um teste gerado para toda tabela.

## O princípio-raiz

> **"Se o programador esquecer, o dado vaza?"**

Se a resposta for "sim", o isolamento depende de memória, e memória falha. A proteção precisa
estar no caminho por onde todo acesso passa, e não em cada consulta.

## O erro que originou a regra

No DeskcommCRM, o isolamento entre empresas foi furado. O desenho de lá ajuda a entender como:
parte do código acessava o banco com privilégio e precisava filtrar a organização à mão, e o
teste de isolamento cobria uma lista fixa de tabelas. A regra existia e estava documentada. O
que faltava era ela ser impossível de esquecer.

## Por que isto vale mesmo com uma empresa só na tela

A fundação opera uma organização por instalação na tela. Mesmo assim o banco nasce com
organização em tudo, por dois motivos:

1. **Acrescentar isolamento depois é a migração mais cara que existe.** Toda tabela, toda
   consulta e todo teste mudam ao mesmo tempo.
2. **Uma chamada é dado sensível.** Transcrição, número de quem ligou, o que foi combinado. O
   custo de errar é alto demais para ficar para depois.

A decisão está registrada na [decisão 0006](../decisions/0006-organizacao-desde-o-primeiro-dia.md).

## A lei

1. **Toda tabela tem `organization_id uuid not null`.** As exceções são duas e estão escritas:
   `organizations` e `schema_migrations`.
2. **Todo acesso a dado de produto passa por `withOrg`.** Dentro dela, a consulta só enxerga a
   organização informada.
3. **Não se escreve SQL fora de `packages/core`.** Processos e pacotes usam as funções do
   núcleo.
4. **O punhado de operações que atravessa organizações é nomeado e pequeno:** entrar no painel,
   reivindicar tarefa da fila, descobrir de que organização é o número chamado. Elas têm uma
   porta própria no núcleo. Não se cria outra sem revisão.
5. **A organização vem de fonte confiável:** a sessão de quem entrou, o número que recebeu a
   chamada, a tarefa reivindicada. Nunca do corpo de uma requisição.
6. **Na API, toda rota exige sessão e organização** antes de tocar no banco.

## Como aplicar

- Vai ler ou gravar dado de produto? Receba a consulta presa à organização. Não abra conexão
  por conta própria.
- Criou tabela? Ela nasce com `organization_id`, e o teste de isolamento passa a cobri-la
  sozinho.
- Uma ferramenta recebe o contexto da chamada já preso à organização. Não aceite organização
  como argumento vindo do modelo.
- Precisa de uma operação que atravessa organizações? Isso é um pedido de decisão, no formato do
  [`GOVERNANCE.md`](../../GOVERNANCE.md), e não um atalho no seu PR.

## Como a regra é cobrada

- **Cerca de organização:** reprova tabela sem `organization_id`.
- **Cerca de SQL:** reprova consulta crua fora de `packages/core`.
- **Teste de isolamento gerado:** para cada tabela com `organization_id`, uma linha da
  organização A não aparece nem é alterada dentro de `withOrg` da organização B. A lista de
  tabelas vem do catálogo do banco, e não de uma lista escrita à mão. Tabela nova entra no teste
  sem ninguém lembrar de acrescentá-la.

Esse último ponto é a correção direta do erro do Deskcomm: lá, o teste cobria uma lista fixa, e
a tabela nova ficava de fora.

## O que o CI não vê

- **Dado de uma organização em texto de log ou em mensagem de erro** devolvida a outra.
- **Identificador previsível** usado como única proteção de um recurso.
- **Cache em memória** compartilhado entre organizações.

Encontrou um vazamento? Não abra issue pública. Siga o [`SECURITY.md`](../../SECURITY.md).

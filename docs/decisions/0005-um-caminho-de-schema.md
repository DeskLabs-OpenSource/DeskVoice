# 0005: Um caminho de schema

- **Estado:** aceita
- **Data:** 2026-11-10
- **Quem decidiu:** construtor da fundação, a partir de erro medido no DeskcommCRM

## Contexto

O DeskcommCRM mantém dois retratos do banco: as migrations e um arquivo de baseline. A
instalação numa VPS aplica só o baseline. Toda mudança de banco precisa sair nos dois lugares, e
nenhum teste confere que eles descrevem o mesmo banco.

O resultado medido: **baseline e migrations divergiram**. Mudanças chegavam a quem desenvolvia e
não chegavam a quem instalava. Em paralelo, migrations com número sequencial colidiam quando
dois PRs escolhiam o mesmo número.

## Decisão

O schema tem **um caminho só**:

- Instalar é aplicar todas as migrations de `db/migrations`, em ordem.
- Atualizar é aplicar as que faltam.
- Não existe baseline, nem outro arquivo que descreva o banco.
- O nome da migration é um carimbo de tempo: `<AAAAMMDDTHHMMSS>_<slug>.sql`.
- Migrations só andam para frente e não são editadas depois de publicadas. O executor guarda o
  hash de cada uma e recusa a que mudou.

A lei completa está na [doutrina de um caminho de schema](../doctrine/um-caminho-de-schema.md).

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Baseline mais migrations, como no Deskcomm | É o desenho que produziu a divergência. Dois retratos só ficam iguais enquanto alguém lembra de atualizar os dois |
| Baseline gerado automaticamente a partir das migrations | Elimina a edição manual, mas mantém dois caminhos: a instalação nova passaria por um, a atualização por outro. O erro possível muda de lugar, e não desaparece |
| Numeração sequencial | Dois PRs abertos ao mesmo tempo escolhem o mesmo número. Com muitos contribuidores, isso acontece toda semana |
| Ferramenta de schema declarativo, que compara o banco com um modelo | Acrescenta uma ferramenta e uma forma de pensar que a maioria dos contribuidores não conhece. SQL em arquivo é o que todos sabem ler |
| Migrations com caminho de volta | O caminho de volta raramente é testado, e passa falsa segurança. A volta de uma atualização que falhou é restaurar o backup feito antes dela |

## Consequências

**Boas:**

- Quem instala hoje e quem atualiza há meses chegam ao mesmo banco, por construção.
- O CI prova isso nos dois sentidos: instalação do zero e atualização a partir da última versão
  publicada.
- Colisão de nome entre PRs paralelos deixa de ser rotina.

**Custos:**

- **A instalação nova aplica o histórico inteiro.** Com o tempo, serão muitas migrations. Hoje é
  irrelevante. Se um dia pesar, a saída é consolidar migrations antigas por uma decisão nova, e
  não reintroduzir um baseline paralelo.
- **Erro publicado fica no histórico.** Corrige-se com outra migration.
- **A ordem depende do carimbo.** Um PR antigo pode entrar com carimbo anterior ao de uma
  migration já aplicada. Por isso o carimbo é conferido e, se preciso, ajustado na fila de
  merge, por um mantenedor.

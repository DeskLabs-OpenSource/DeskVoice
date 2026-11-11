# Doutrina de versionamento

> Lei sobre **o número da versão**: com que régua ele é decidido, quem o decide e o que ele
> promete a quem já tem o DeskVoice instalado.

## O princípio-raiz

A pergunta que decide o número **não é** "o que mudou no código?". Tudo muda, e uma régua que
mede tudo não separa nada.

A pergunta é:

> **"O que o dono da VPS precisa fazer?"**

O número não é medalha de esforço nem medida de tamanho. É uma promessa operacional para alguém
que vai atualizar sem ler o diff, num servidor em que o telefone da empresa está tocando agora.

Quem lê o número é o operador, não o autor. A régua é escrita da cadeira dele.

## A régua

| O que acontece com quem já instalou | `impact` do fragmento | Número |
|---|---|---|
| Não precisa fazer nada, e nada do que funcionava mudou de forma | `nothing_changes` | O último número sobe |
| Não precisa fazer nada, e o sistema ganhou capacidade nova | `new_capability` | O número do meio sobe |
| Precisa agir | `operator_action` | O número do meio sobe, **e o aviso vai em destaque** |

A terceira linha é a parte que mais importa, e tem seção própria abaixo.

**Versão maior só sai por decisão explícita do dono do projeto.** Nenhum fragmento, workflow ou
agente produz versão maior.

### O teste de uma linha

Antes de classificar, escreva a frase que o operador vai ler antes de atualizar:

- "Você não precisa fazer nada." → `nothing_changes`.
- "Você não precisa fazer nada. Agora o sistema também faz X." → `new_capability`.
- "Antes de atualizar, você precisa…" → `operator_action`, com a ação escrita.

### Por que "mudou o comportamento" não é a régua

Um conserto de defeito, por definição, muda o comportamento. Com essa régua, todo conserto vira
capacidade nova, e o número deixa de distinguir "consertamos o que estava quebrado" de "o
sistema faz algo novo". O DeskcommCRM viveu isso, e a régua pela pergunta do operador nasceu lá.

## "Exige ação do operador" é campo separado do número

Juntar as duas coisas num número só produz dois erros opostos:

- Uma mudança pequena que exige ação fica com número pequeno, e o operador atualiza sem saber
  que precisava fazer algo.
- Para evitar isso, tudo o que exige ação ganha número grande, e o número grande deixa de
  significar o que deveria.

Por isso são duas informações independentes. Uma mudança que exige ação não ganha um número
especial: ela ganha um **aviso**, que aparece no topo das notas e no título da versão, qualquer
que seja o número.

| Informação | Responde | Quem lê |
|---|---|---|
| O número | O sistema ganhou capacidade, ou só foi consertado? | Quem acompanha o projeto |
| Exige ação do operador | Preciso fazer alguma coisa antes ou depois de atualizar? O quê? | Quem vai atualizar |

O custo que o campo mede é o do operador, e não o do autor. Uma mudança de três linhas que pede
um passo manual exige ação. Uma reescrita de mil linhas que não pede nada, não.

O que conta como ação: rodar um comando, preencher um campo novo na tela, reconfigurar o tronco,
conferir algo na operadora, avisar a equipe de que uma tela mudou de lugar.

### O ideal é o campo vazio

A regra do projeto é que **atualizar não exige nada do operador**. Mudança que exigiria editar
arquivo à mão na VPS não entra: vira issue com um plano de migração que faça a atualização
cuidar disso sozinha. O campo existe para as exceções que sobrarem, e não como licença para
criá-las.

## Fragmentos em `.changes/`

Ninguém edita o arquivo de notas de versão à mão, e ninguém digita o número. Cada mudança traz
o próprio **fragmento**: um arquivo pequeno em `.changes/`, com três campos e um parágrafo.

```markdown
---
impact: new_capability
section: added
title: O agente transfere a ligação para um humano
---

Durante a chamada, o agente agora pode passar a ligação para o número configurado no painel,
em Agentes. Nada a configurar em instalações existentes. Crédito: @seu-usuario.
```

| Campo | Valores | O que responde |
|---|---|---|
| `impact` | `nothing_changes`, `new_capability`, `operator_action` | O que acontece com quem já tem uma instalação rodando |
| `section` | `added`, `changed`, `fixed` | Em que parte das notas o item aparece |
| `title` | Uma frase | O que muda, na voz de quem usa |

Um fragmento com `operator_action` é obrigado a trazer um bloco `## Requer atenção`, dizendo
exatamente o que fazer. O contrário também é recusado: bloco de atenção sem `operator_action`.

No lançamento, os fragmentos são somados: o maior impacto decide o número, os títulos viram as
notas, os avisos vão para o topo, e os fragmentos são apagados.

O porquê do fragmento é o mesmo da [doutrina de um arquivo por peça](um-arquivo-por-peca.md): um
arquivo de notas único é um arquivo que todo PR edita, e todo PR colidiria nele.

Regras do fragmento:

1. **Um fragmento por mudança que o operador percebe.** Refatoração interna sem efeito para quem
   usa não precisa de fragmento.
2. **O título é escrito para o operador**, em português, sem nome de função. "A linha do tempo
   agora mostra o custo de cada ferramenta", e não "adiciona campo `cost` ao payload".
3. **Quem escolhe o impacto é a régua**, e não o tamanho do diff.
4. **O número não é escolhido por ninguém.** Ele é calculado a partir dos fragmentos.
5. **As notas nomeiam quem fez.** O parágrafo do fragmento termina com o crédito a quem fez a
   mudança.

O formato completo e os comandos estão em [`.changes/README.md`](../../.changes/README.md). A
cerca `release-fragments-are-valid` reprova fragmento malformado, e `pnpm release:check` diz que
versão sairia com os fragmentos atuais.

**Contribuindo de fora?** O fragmento é trabalho dos mantenedores. Se você souber escrevê-lo,
ajuda. Se não, mande o PR sem ele. Está dito em [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Quem decide

| Decisão | Quem |
|---|---|
| Impacto de uma mudança | Quem escreve o fragmento, pela régua. A revisão confere |
| Número da versão | Ninguém. É calculado |
| Se a mudança exige ação | Quem escreve o fragmento. Na dúvida, exige |
| Versão maior | Só o dono do projeto |
| Quando lançar | Mantenedores |

## Verificação

- A cerca de fragmentos reprova fragmento inválido.
- O CI atualiza uma instalação da última versão publicada, com dados, até o estado do PR. É a
  prova de que "você não precisa fazer nada" é verdade.
- Na revisão: a frase do teste de uma linha está escrita no PR?

## Documentos relacionados

- [`um-caminho-de-schema.md`](um-caminho-de-schema.md): o que a atualização faz com o banco.
- [`GOVERNANCE.md`](../../GOVERNANCE.md): a regra de produto "quem já instalou não é surpreendido".

# Fragmentos de versão

Cada mudança que quem opera uma instalação percebe traz **um arquivo** aqui: `.changes/<slug>.md`.
Na hora da release, os fragmentos viram a seção nova do `CHANGELOG.md` e são apagados. Ninguém
edita o `CHANGELOG.md` à mão e ninguém digita o número da versão.

Por que assim: um arquivo por mudança não dá conflito entre PRs paralelos (um `CHANGELOG.md`
editado por todos dá sempre), e o número calculado não depende de alguém lembrar a última tag.

## Formato

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
| `impact` | `nothing_changes`, `new_capability`, `operator_action` | O que acontece com quem **já tem** uma instalação rodando |
| `section` | `added`, `changed`, `fixed` | Em que parte da nota o item aparece |
| `title` | uma frase | O que muda, na voz de quem usa. Vira o negrito que abre o item |

O corpo é **um parágrafo**, escrito para quem opera a instalação e nunca viu o código, e termina
com o crédito a quem fez (`Crédito: @usuario.`). Sem títulos, sem lista de arquivos alterados.

### Quando o operador precisa agir

`impact: operator_action` exige um bloco `## Requer atenção` dizendo exatamente o que fazer:

```markdown
---
impact: operator_action
section: changed
title: O áudio das chamadas passa a usar outra faixa de portas
---

A faixa de portas de áudio mudou para caber mais chamadas simultâneas. Crédito: @seu-usuario.

## Requer atenção

Libere as portas UDP 10000 a 10400 no firewall da VPS antes de atualizar. Sem isso as ligações
conectam e ficam mudas.
```

O contrário também é recusado: bloco `## Requer atenção` sem `impact: operator_action`.

## A régua da versão

| `impact` | Versão |
|---|---|
| `nothing_changes` (conserto; nada a fazer nem a aprender) | patch |
| `new_capability` (dá para fazer algo que antes não dava) | minor |
| `operator_action` (quem atualiza precisa fazer algo) | minor, com o aviso em destaque na nota |

Vale o maior entre os fragmentos da release. **Major só por decisão explícita** do dono do
projeto (`--major`); nenhum fragmento produz major. "Exige ação do operador" é um campo separado
do número: aparece no topo da nota e no título da release, qualquer que seja a versão.

## Comandos

```bash
pnpm release:check                              # valida os fragmentos e diz que versão sairia
pnpm exec tsx scripts/release.ts cut            # mantenedores: monta o CHANGELOG.md e apaga os fragmentos
pnpm exec tsx scripts/release.ts cut --major    # só por decisão do dono
```

A cerca `fences/release-fragments-are-valid.test.ts` reprova fragmento inválido no `pnpm verify`.
O corte de verdade acontece no workflow `release` (`.github/workflows/release.yml`): ele abre o PR
`release/X.Y.Z`, e o merge desse PR cria a tag.

## Não sabe se precisa de fragmento?

Mudou algo que o dono de uma instalação percebe (tela, ligação, instalador, custo)? Precisa.
Só teste, refatoração interna ou documentação de contribuição? Não precisa. Na dúvida, abra o PR
sem: escrever o fragmento que faltou é trabalho dos mantenedores, com o seu crédito.

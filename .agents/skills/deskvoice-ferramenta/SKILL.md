---
name: deskvoice-ferramenta
description: 'Como criar ou alterar uma ferramenta que o agente do DeskVoice usa DURANTE a chamada (consultar um sistema, agendar, avisar alguém, cobrar, transferir). Use quando a pessoa pedir "quero que o agente faça X na ligação", "criar uma tool", "o agente precisa consultar meu sistema", "adicionar uma ferramenta", ou for mexer em packages/tools. Cobre: um arquivo em packages/tools/src/tools/, a interface Tool, validação com zod, eventos na linha do tempo, teste, e quando pedir aprovação humana.'
---

# Adicionar uma ferramenta

Uma ferramenta é **um arquivo** em `packages/tools/src/tools/`, com o teste ao lado. `loadTools()`
descobre pela pasta: você não edita lista, índice nem registro (a cerca `one-file-per-piece`
reprova quem tenta). O guia longo, com exemplo completo, é
[`docs/guides/adicionar-uma-ferramenta.md`](../../../docs/guides/adicionar-uma-ferramenta.md).

## 0. Precisa mesmo de uma ferramenta nova?

| Situação | Caminho |
|---|---|
| O agente só precisa avisar um sistema externo | `call_webhook`, com URL cadastrada na tela. Sem código |
| Algo precisa acontecer depois da chamada | `create_task` enfileira uma tarefa |
| O agente precisa consultar ou executar algo e usar a resposta na conversa | Ferramenta nova |
| É regra de um ramo de negócio ou de uma empresa só | Não entra no núcleo: webhook, ou no seu fork |

## 1. O contrato (`packages/tools/src/types.ts`)

```ts
interface Tool<Input = unknown> {
  name: string;                         // snake_case em inglês; é o nome do arquivo
  description: string;                  // escrita PARA O MODELO
  parameters: Record<string, unknown>;  // JSON Schema entregue ao motor de voz
  inputSchema: ZodType<Input>;          // validação da entrada
  run(input: Input, ctx: ToolContext): Promise<ToolResult>;
}
interface ToolResult { ok: boolean; message: string; data?: unknown }
interface ToolContext {
  organizationId: string; callId: string; agentId: string;
  q: OrgQuery;      // banco, já preso à organização da chamada
  clock: Clock;     // a hora vem daqui, nunca de `new Date()`
  telephony: { transfer(toE164: string): Promise<void>; hangup(): Promise<void> };
  say(text: string): void;
  waitForApproval(approvalId: string, timeoutMs: number): Promise<ApprovalOutcome>;
}
```

Confira a interface no arquivo antes de escrever: se este resumo divergir, vale o arquivo.

## 2. Passo a passo

1. **Abra uma ferramenta vizinha** em `packages/tools/src/tools/` e copie a forma de exportar e
   de registrar eventos. A descoberta por pasta espera o mesmo formato em todas.
2. **Crie `packages/tools/src/tools/<nome>.ts`.**
3. **`description`**: diga quando usar **e quando não usar**. É ela que faz o modelo decidir.
4. **`inputSchema` (zod) e `parameters` (JSON Schema) descrevem a mesma entrada.** O modelo erra:
   campo faltando, tipo trocado, valor inventado. Entrada inválida devolve `ok: false` com uma
   mensagem que ajude o modelo a corrigir; não lança erro.
5. **Nada do contexto vem do modelo.** Organização, chamada e agente saem do `ctx`. URL de destino
   e chave de serviço são configuração do operador (banco, cifrada, com tela), nunca argumento.
6. **`run`**:
   - banco só por `ctx.q` (`q.many`, `q.one`, `q.exec`). Consulta nova que atravessa
     organizações nasce em `packages/core`;
   - vai demorar mais de um instante? `ctx.say("Um instante, estou conferindo.")` antes. Três
     segundos de silêncio ao telefone parecem ligação caída;
   - `message` é o que o modelo recebe: o que aconteceu **e o que ele deve dizer** a quem está na
     linha;
   - falhou? `ok: false`, com uma saída (oferecer transferência, anotar recado). Nunca devolva
     sucesso sem sucesso.
7. **Eventos**: toda execução registra `tool_called` e `tool_result` na linha do tempo
   (`recordEvent`, de `@deskvoice/core`), do jeito que as vizinhas fazem. Sem senha, chave ou dado
   de cartão no `payload`.
8. **Telefone** sempre por `toE164` antes de gravar ou comparar.

## 3. Quando pedir aprovação humana

| A ação | O que fazer |
|---|---|
| Só lê, ou é desfeita sem custo | Executa direto |
| Tem efeito para quem ligou, e a própria pessoa pode confirmar (remarcar, cancelar o próprio pedido) | A `description` manda o agente confirmar em voz alta, nomeando o que vai acontecer, antes de chamar |
| Gasta dinheiro, concede algo, abre exceção à regra, ou afeta terceiros | A decisão não é do agente: `request_approval` cria o pedido, avisa a equipe e espera. `ctx.waitForApproval(approvalId, timeoutMs)` devolve `approved`, `denied` ou `expired` |

Prazo esgotado não é erro: o pedido vira `expired`, vale o `default_on_timeout`, e a `message`
diz ao agente como seguir a conversa. Lei:
[`destrutivo-pede-confirmacao.md`](../../../docs/doctrine/destrutivo-pede-confirmacao.md).

Ferramenta que origina ligação passa por `checkOutboundAllowed`. Não crie outro caminho:
[`ligacoes-de-saida.md`](../../../docs/doctrine/ligacoes-de-saida.md).

## 4. O teste (`<nome>.test.ts`, ao lado)

No mínimo quatro casos:

1. caminho feliz: entrada válida, resultado esperado, `tool_called` e `tool_result` registrados;
2. entrada inválida: `ok: false`, sem exceção;
3. dependência fora do ar: `ok: false`, com mensagem útil;
4. sem configuração: a ferramenta diz que não está configurada.

Relógio falso no `ctx.clock`. Servidor de mentira, se precisar, na porta `0`. Usa banco de
verdade? O arquivo se chama `<nome>.db.test.ts` e roda em `pnpm test:db`.

```bash
pnpm vitest run --project unit packages/tools
pnpm vitest run --project unit apps/voice     # a chamada simulada de ponta a ponta
pnpm verify
```

Prove por sabotagem: tire a validação (ou o tratamento da falha), veja o teste cair, restaure.

## 5. Antes do PR

- [ ] O PR toca só o arquivo da ferramenta, o teste e, se há configuração, a tela dela.
- [ ] A descrição diz quando usar e quando não usar.
- [ ] Toda falha devolve mensagem com saída. Demora tem `ctx.say`.
- [ ] Ação sem volta pede confirmação ou aprovação.
- [ ] Texto de tela novo está nos dicionários de `apps/panel/src/i18n/` (pt-BR, en, es).
- [ ] Fragmento em `.changes/` (`impact: new_capability`, `section: added`).

O caminho do PR é a skill `deskvoice-contribuir`.

# Adicionar uma ferramenta

Uma ferramenta é o que o agente **faz** durante a chamada: avisar alguém, pedir uma aprovação,
chamar um webhook, transferir. Este guia mostra como escrever uma.

É a contribuição mais comum e a mais simples: **uma ferramenta é um arquivo.** Você não edita
lista, índice nem registro. O sistema descobre a ferramenta pela pasta.

> Usa um assistente de código? Abra o repositório nele e peça para criar uma ferramenta. A skill
> `deskvoice-ferramenta` carrega este roteiro.

## Antes de escrever: precisa mesmo de uma ferramenta nova?

| Situação | Caminho |
|---|---|
| Preciso que o agente avise um sistema meu de algo | A ferramenta `call_webhook` já faz isso, para URLs cadastradas na tela. Sem código |
| Preciso que algo aconteça depois da chamada | A ferramenta `create_task` abre uma pendência com responsável e prazo |
| Preciso que o agente consulte ou execute algo e use a resposta na conversa | Ferramenta nova. Siga este guia |

E uma segunda pergunta: **a ferramenta é de uso geral ou de um ramo de negócio?**

- **Uso geral** (agenda, cobrança, consulta a um CRM): pode virar contribuição para o
  repositório.
- **De nicho** (a regra de uma clínica, o sistema interno de uma empresa): não entra no núcleo.
  Hoje, o caminho é o webhook ou manter a ferramenta no seu fork. Carregar ferramentas de fora
  do repositório é uma frente aberta no [`ROADMAP.md`](../../ROADMAP.md).

## Onde a ferramenta mora

Em `packages/tools/src/tools/`, um arquivo por ferramenta, com o teste ao lado. O nome do
arquivo é o nome da ferramenta, em inglês e com sublinhado, como as que já existem: `end_call`,
`transfer_to_human`, `notify_human`, `request_approval`, `send_whatsapp`, `call_webhook`,
`create_task`.

Abra uma delas antes de começar. A forma de exportar e de registrar eventos é a que está lá, e
a descoberta por pasta espera o mesmo formato.

## O contrato

Toda ferramenta implementa a interface `Tool`:

```ts
interface Tool<Input = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema entregue ao motor de voz
  inputSchema: ZodType<Input>;         // validação da entrada
  personalTextArgs?: boolean;          // os argumentos são texto sobre quem ligou: não vão para `tool_called`
  run(input: Input, ctx: ToolContext): Promise<ToolResult>;
}

interface ToolResult {
  ok: boolean;
  message: string; // texto devolvido ao modelo
  data?: unknown;
}
```

E recebe, ao rodar, o contexto da chamada:

```ts
interface ToolContext {
  organizationId: string;
  callId: string;
  agentId: string;
  q: OrgQuery;          // acesso ao banco, já preso à organização
  clock: Clock;         // use isto, nunca `new Date()`
  telephony: {
    transfer(toE164: string): Promise<void>;
    hangup(): Promise<void>;
  };
  say(text: string): void; // faz o agente dizer algo enquanto a ferramenta trabalha
  waitForApproval(approvalId: string, timeoutMs: number): Promise<ApprovalOutcome>;
}
```

## Um exemplo

Uma ferramenta que informa se a empresa está aberta agora. Ela é pequena de propósito: mostra a
forma, e não uma integração.

```ts
import { z } from "zod";
import type { Tool } from "../types";

const inputSchema = z.object({
  // Dia e hora que a pessoa perguntou. Sem valor, a ferramenta usa o momento da chamada.
  at: z.string().datetime().optional(),
});

type Input = z.infer<typeof inputSchema>;

export const checkOpeningHours: Tool<Input> = {
  name: "check_opening_hours",
  description:
    "Informa se a empresa está aberta em um dia e horário. Use quando a pessoa perguntar " +
    "sobre horário de funcionamento. Não use para marcar ou remarcar horário.",
  parameters: {
    type: "object",
    properties: {
      at: {
        type: "string",
        description: "Data e hora em ISO 8601. Omita para consultar o momento atual.",
      },
    },
  },
  inputSchema,

  async run(input, ctx) {
    const when = input.at ? new Date(input.at) : ctx.clock.now();
    const hours = await loadOpeningHours(ctx.q); // lê a configuração da organização

    if (!hours) {
      return {
        ok: false,
        message:
          "O horário de funcionamento não está configurado. Diga que você não tem essa " +
          "informação e ofereça transferir para uma pessoa.",
      };
    }

    const open = isOpenAt(hours, when);
    return {
      ok: true,
      message: open
        ? "A empresa está aberta nesse horário."
        : "A empresa está fechada nesse horário. Informe o próximo horário de abertura.",
      data: { open },
    };
  },
};
```

O exemplo é ilustrativo. `loadOpeningHours` e `isOpenAt` não existem no repositório: são o
trabalho da sua ferramenta. Confira a forma de exportação numa ferramenta vizinha antes de
copiar.

## As sete regras de uma boa ferramenta

### 1. A descrição é escrita para o modelo

É a descrição que faz o agente decidir usar a ferramenta. Diga **quando usar** e **quando não
usar**. Uma descrição vaga faz o agente chamar a ferramenta na hora errada, ou nunca.

### 2. A entrada vem do modelo, e o modelo erra

Valide tudo com zod. O modelo pode mandar campo faltando, tipo errado ou um valor inventado.
Entrada inválida devolve `ok: false` com uma mensagem que ajude o modelo a corrigir.

Nunca aceite como argumento algo que o contexto já fornece. Organização, chamada e agente vêm
do `ctx`, e não do modelo.

### 3. A mensagem de retorno diz ao agente o que falar

`message` não é um log. É o texto que o modelo recebe para continuar a conversa. Escreva o que
aconteceu e o que ele deve dizer a quem está na linha.

### 4. Falha nunca é silêncio

Se não deu certo, devolva `ok: false` com uma mensagem clara e uma saída: oferecer transferência,
anotar o recado. Nunca devolva sucesso quando não houve sucesso. A ferramenta `send_whatsapp` é
o exemplo da casa: sem conector configurado, ela diz isso, em vez de fingir que enviou.

### 5. Quem está na linha não pode ficar no vazio

Se a ferramenta demora mais de um instante, use `ctx.say` antes de começar: "Um instante, estou
conferindo." Três segundos de silêncio ao telefone parecem uma ligação caída.

### 6. O que a ferramenta faz aparece na linha do tempo

Toda execução registra `tool_called` e `tool_result`. Veja como as ferramentas existentes fazem,
e siga a mesma forma. Não coloque dado sensível no evento: senha, chave, número de cartão.

Se os argumentos que o modelo manda são texto sobre a pessoa que ligou (o título de uma pendência,
uma nota sobre ela), declare `personalTextArgs: true` no próprio arquivo da ferramenta. Aí
`tool_called` grava `{ omitted: "personal_text" }` no lugar dos argumentos: a linha do tempo não sai
pelo prazo de guarda, e o texto precisa morar num lugar que o prazo e a exportação alcançam. É o que
`create_task` faz, guardando o texto na pendência.

### 7. Ação que não tem volta pede confirmação

Se a ferramenta cancela, apaga ou cobra, diga na descrição que o agente deve confirmar com a
pessoa antes, nomeando o que vai acontecer. Se a decisão não deve ser do agente, use
`request_approval` para pedir a um humano da equipe. A lei está na
[doutrina da ação destrutiva](../doctrine/destrutivo-pede-confirmacao.md).

## Regras de forma que a máquina cobra

- **Banco só pelo `ctx.q`.** SQL fora de `packages/core` reprova. Se a ferramenta precisa de uma
  consulta nova, a função mora no núcleo.
- **Hora só pelo `ctx.clock`.**
- **Chamada HTTP para fora:** não aceite URL vinda do modelo. Endereço de destino é configuração
  do operador, feita na tela. A ferramenta `call_webhook` recusa endereço privado e de loopback:
  siga o mesmo cuidado.
- **Segredo** (chave de um serviço externo) é configuração cifrada, e nunca variável de
  ambiente nova.
- **Configuração tem tela.** Se a ferramenta precisa de um dado do operador, ele informa pelo
  painel.

## O teste

O teste mora ao lado da ferramenta. No mínimo:

1. **Caminho feliz:** entrada válida, resultado esperado, eventos registrados.
2. **Entrada inválida:** devolve `ok: false`, não lança erro.
3. **Dependência falhando:** o serviço externo fora do ar devolve `ok: false` com mensagem
   útil.
4. **Sem configuração:** a ferramenta diz que não está configurada.

O teste recebe um relógio falso e não abre porta fixa. Se precisar de um servidor de mentira,
abra na porta `0`.

Depois, veja a ferramenta numa chamada inteira com o motor simulado: o roteiro dele tem um passo
que faz o agente chamar uma ferramenta.

## Antes de abrir o PR

```bash
pnpm verify
```

E a lista do que o CI não vê:

- [ ] A descrição diz quando usar e quando não usar.
- [ ] Toda falha devolve mensagem com uma saída para o agente.
- [ ] Demora tem `ctx.say`.
- [ ] Ação sem volta pede confirmação ou aprovação.
- [ ] Nenhum dado sensível nos eventos.
- [ ] Não há regra de um ramo de negócio dentro da ferramenta.
- [ ] Se a ferramenta precisa de configuração, existe tela para ela.

O PR de uma ferramenta nova deveria tocar a pasta da ferramenta e, se houver configuração, a
tela. Tocou em outro lugar? Explique por quê na descrição.

## Documentos relacionados

- [`um-arquivo-por-peca.md`](../doctrine/um-arquivo-por-peca.md): por que não há lista central.
- [`sistema-vivo.md`](../doctrine/sistema-vivo.md): as perguntas que a peça responde.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md): o caminho do PR.

import type { AgentTestTurns } from "@deskvoice/core";
import type { SimulatedScript } from "@deskvoice/voice-engine";

/**
 * O teste da Lia que o `pnpm demo` roda depois da chamada (item 7, fatia 7a). A expectativa foi
 * escrita como um operador escreveria, a partir do pedido da cliente, e não copiada do roteiro:
 * ela confere só o que importa (a pendência fala da Marina e da sexta, a ligação termina com um
 * motivo), e o roteiro é livre no resto. Trocar a ferramenta ou o argumento no roteiro reprova.
 */
export const LIA_TEST_NAME = "Remarcação da Marina";

export const LIA_TEST_TURNS: AgentTestTurns = [
  {
    user: "Oi, bom dia. Aqui é a Marina Duarte. Preciso remarcar a limpeza de pele de quinta às duas da tarde. Para mim, sexta de manhã é melhor.",
    expect: {
      tools: [
        {
          tool: "create_task",
          args: { title: { contains: "marina" }, details: { contains: "sexta" } },
          result: { ok: true, message: "Pendência aberta para a recepção." },
        },
      ],
      forbid: ["transfer_to_human"],
      says: ["recepção"],
    },
  },
  {
    user: "Era só isso, obrigada.",
    expect: {
      tools: [{ tool: "end_call", args: { reason: { present: true } }, result: { ok: true, message: "A ligação vai ser encerrada." } }],
      saysNot: ["desconto"],
    },
  },
];

/**
 * O roteiro do motor simulado no teste: faz o papel do modelo. No motor simulado quem decide a
 * ferramenta é este roteiro, e não as instruções da Lia; com um motor real (fatia 7b), quem decide
 * é o modelo.
 */
export function liaTestScript(): SimulatedScript {
  return [
    { expectUserAudio: 1000 },
    { say: "Claro, Marina. Vou deixar o pedido de remarcação anotado para a recepção confirmar o novo horário com você." },
    {
      toolCall: {
        name: "create_task",
        args: {
          title: "Confirmar com Marina Duarte o novo horário da limpeza de pele",
          details: "Ela tem limpeza de pele marcada para quinta às 14h e prefere sexta de manhã. Retornar para confirmar o novo horário.",
        },
      },
    },
    { say: "Pronto, a recepção já tem o pedido e retorna para confirmar." },
    { expectUserAudio: 1000 },
    { say: "Obrigada por ligar, Marina. Tenha um bom dia." },
    { toolCall: { name: "end_call", args: { reason: "Pedido registrado; a cliente se despediu." } } },
  ];
}

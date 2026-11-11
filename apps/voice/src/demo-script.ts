import type { SimulatedScript } from "@deskvoice/voice-engine";

/** As ferramentas que o roteiro usa. A chamada simulada as habilita, seja qual for a lista do agente. */
export const DEMO_TOOLS = ["notify_human", "request_approval", "transfer_to_human", "end_call"];

/** Quanto a aprovação da demonstração espera por alguém no painel antes de valer o padrão do operador (negar, se ele não mudou). */
export const DEMO_APPROVAL_TIMEOUT_SECONDS = 60;

/**
 * Roteiro da chamada simulada: uma ligação verossímil para um negócio local, que passa pelo que o
 * produto faz. O motor simulado não ouve nem decide: ele segue estes passos, e as ferramentas
 * rodam de verdade (o aviso chega ao painel, a aprovação espera a decisão de uma pessoa).
 *
 * Antes do primeiro passo o motor fala a abertura que a conversa montou: o aviso de gravação e,
 * se o agente tiver, a saudação dele.
 *
 * `greet`: fala a saudação do roteiro, depois do aviso; falso quando o agente já tem a dele.
 * `canTransfer`: o agente tem número de transferência; sem ele o roteiro termina em despedida.
 */
export function demoScript(options: { greet: boolean; canTransfer: boolean }): SimulatedScript {
  return [
    ...(options.greet ? [{ say: "Clínica Bem Viver, bom dia. Aqui é a Lia, assistente virtual da recepção. Como posso ajudar?" }] : []),
    {
      expectUserAudio: 3000,
      text: "Oi, bom dia. Aqui é a Marina Duarte. Tenho uma limpeza de pele marcada para quinta às duas da tarde e preciso remarcar. E queria saber se consigo um desconto fechando o pacote de três sessões.",
    },
    { say: "Claro, Marina. Vou deixar o pedido de remarcação anotado para a recepção confirmar o novo horário com você." },
    {
      toolCall: {
        name: "notify_human",
        args: {
          message: "Marina Duarte pediu para remarcar a limpeza de pele de quinta às 14h. Prefere sexta de manhã. Retornar para confirmar o novo horário.",
          urgency: "normal",
        },
      },
    },
    { say: "Pronto, a recepção já foi avisada da remarcação. Sobre o desconto no pacote, eu não posso decidir sozinha." },
    {
      toolCall: {
        name: "request_approval",
        args: {
          question: "Posso dar 10% de desconto no pacote de três sessões de limpeza de pele?",
          context: "Marina Duarte, cliente da clínica, quer fechar o pacote de três sessões hoje e pediu desconto. Ela está na linha aguardando a resposta.",
          timeout_seconds: DEMO_APPROVAL_TIMEOUT_SECONDS,
        },
      },
    },
    { expectUserAudio: 1000 },
    { say: "Obrigada por aguardar, Marina. Já tenho a resposta da responsável, e a recepção confirma os detalhes do pacote com você." },
    ...(options.canTransfer
      ? [
          { say: "Vou transferir você para a recepção fechar o horário. Um instante, por favor." },
          {
            toolCall: {
              name: "transfer_to_human",
              args: {
                reason: "A cliente quer fechar o novo horário e o pacote com a recepção.",
                summary: "Marina Duarte quer remarcar a limpeza de pele de quinta às 14h para sexta de manhã e fechar o pacote de três sessões. O pedido de desconto de 10% já passou pela responsável; veja a decisão nas aprovações.",
              },
            },
          },
        ]
      : [
          { say: "A recepção retorna ainda hoje para confirmar o novo horário. Obrigada por ligar, Marina. Tenha um bom dia." },
          { toolCall: { name: "end_call", args: { reason: "Pedido registrado; a cliente se despediu." } } },
        ]),
  ];
}

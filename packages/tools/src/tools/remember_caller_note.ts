import { CALLER_NOTE_MAX, saveCallerNote } from "@deskvoice/core";
import { z } from "zod";
import { defineTool } from "../define-tool";

/**
 * Guarda uma nota sobre quem está na linha, para a equipe ver na próxima ligação do mesmo número
 * (fatia 3 do desenho de 13/11, registro 0020). O telefone vem da chamada, nunca do modelo; o texto
 * mora só em `caller_notes`, onde o prazo da memória, o prazo de guarda e o apagamento a pedido do
 * titular o alcançam. O resultado devolvido ao modelo não repete a nota.
 */
export default defineTool({
  name: "remember_caller_note",
  description:
    "Guarda uma nota curta sobre quem está na linha para a próxima ligação deste mesmo número (ex.: 'prefere ser atendida de manhã', 'o pedido é o 4471'). A equipe vê a nota na tela da chamada. Use só para o que a pessoa disse e vai importar numa próxima vez. NÃO use para pedido de ação da equipe (use create_task), nem para dado sensível que a pessoa não precisaria repetir (senha, número de cartão, diagnóstico).",
  inputSchema: z.object({
    text: z.string().trim().min(1).max(CALLER_NOTE_MAX).describe(`A nota, em uma ou duas frases, com até ${CALLER_NOTE_MAX} caracteres.`),
  }),
  // A nota fala de quem ligou: fica só em `caller_notes`, e não nos argumentos gravados na linha do tempo.
  personalTextArgs: true,
  // Vem desligada: o agente só a tem quando alguém a marca na tela dele (registro 0020, 1A).
  offByDefault: true,
  async run(input, ctx) {
    const saved = await saveCallerNote(ctx.q, { callId: ctx.callId, text: input.text }, ctx.clock.now());
    switch (saved.status) {
      case "saved":
        return { ok: true, message: "Anotado para as próximas ligações deste número. Siga a conversa; não leia a nota para a pessoa.", data: { noteId: saved.id } };
      case "no_number":
        return {
          ok: false,
          noEffect: true,
          message: "Esta ligação não tem um número de telefone identificado, então nada foi anotado. Siga a conversa normalmente, sem dizer que anotou.",
        };
      case "limit":
        return { ok: false, noEffect: true, message: "Nesta ligação o limite de notas já foi alcançado, e esta não foi guardada. Siga a conversa normalmente, sem dizer que anotou." };
      case "not_found":
        return { ok: false, noEffect: true, message: "Não foi possível anotar agora. Siga a conversa normalmente, sem dizer que anotou." };
    }
  },
});

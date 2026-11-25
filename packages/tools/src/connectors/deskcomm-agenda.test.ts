import type { Clock } from "@deskvoice/core";
import { describe, expect, it } from "vitest";
import { fakeLookup } from "../../test/helpers";
import { drippingPings, fakeMcp, type McpRpc, type Reply } from "../../test/mcp-server";
import { AgendaError, type AgendaErrorKind, type AgendaRefusal } from "./agenda";
import { createDeskcommAgendaClient, type DeskcommAgendaConfig } from "./deskcomm-agenda";

/** Terça, 17/11/2026, 12h em São Paulo. */
const AGORA = new Date("2026-11-17T15:00:00.000Z");
const CRM = "https://crm.exemplo.com";
const CHAVE = "5f0c1c1e-8a52-4c7e-9a43-2f6d0f2b9e10";
const QUEM_LIGOU = "+14155550123";
const CONTATO = "0b6f6d38-3c7e-4f7e-9d0a-1f1d6c0f5e11";
const OUTRO_CONTATO = "7c1e2a90-55d4-4b0b-8f3e-6a0d2b9c4e22";
const CONTATO_NOVO = "c3a4b5d6-1e2f-4a3b-8c4d-5e6f7a8b9c33";
const COMPROMISSO = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c44";

/** O que o CRM devolveu de verdade em 24/11/2026 (`crm_list_event_types`), com um tipo a mais. */
const TIPOS = {
  tipos: [
    { slug: "consulta", nome: "Consulta", descricao: null, duracao_minutos: 30, onde: "Presencial", preco_padrao_cents: null, precisa_confirmacao: false },
    { slug: "visita-de-orcamento", nome: "Visita de Orçamento", descricao: null, duracao_minutos: 60, onde: "No local", preco_padrao_cents: null, precisa_confirmacao: false },
  ],
};

/** Uma agenda com três horários: um antes da janela pedida, um dentro e um depois. */
const HORARIOS = {
  horarios: [
    { inicio: "2026-11-18T12:00:00.000Z", fim: "2026-11-18T13:00:00.000Z", quando: "Qua 18/11 às 09:00" },
    { inicio: "2026-11-19T17:00:00.000Z", fim: "2026-11-19T18:00:00.000Z", quando: "Qui 19/11 às 14:00" },
    { inicio: "2026-11-21T12:00:00.000Z", fim: "2026-11-21T13:00:00.000Z", quando: "Sáb 21/11 às 09:00" },
  ],
  total_de_horarios: 3,
  ha_mais: false,
  fuso_da_regra: "America/Sao_Paulo",
  publicou_horarios: true,
  fuso_suposto: false,
  fontes_defasadas: [],
  agenda_externa_nunca_lida: false,
};

const MARCADO = {
  marcado: true,
  compromisso: { id: COMPROMISSO, starts_at: "2026-11-19T17:00:00+00:00", ends_at: "2026-11-19T18:00:00+00:00", status: "confirmed", time_zone: "America/Sao_Paulo", quando: "Qui 19/11 às 14:00" },
  aguarda_confirmacao: false,
};

const contato = (id: string, phone: string | null) => ({ id, name: "Fulano", phone, email: null, tags: [], is_blocked: false, is_anonymized: false });

interface CrmFalsoOptions {
  /** A resposta de cada ferramenta; ausente, a resposta boa de cima. */
  tools?: Partial<Record<string, (args: Record<string, unknown>) => unknown>>;
  /** Quebra o protocolo numa ferramenta (HTTP de erro, prazo, `isError`). */
  quebra?: (tool: string, signal: AbortSignal | undefined) => Reply | undefined;
  /** A resposta do `open-with-contact`. */
  abrir?: () => Response;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** O CRM inteiro de mentira: o `/api/mcp` pelo servidor MCP falso e a rota REST que cria o contato. */
function crmFalso(options: CrmFalsoOptions = {}) {
  const respostas: Record<string, (args: Record<string, unknown>) => unknown> = {
    crm_list_event_types: () => TIPOS,
    crm_find_free_slots: () => HORARIOS,
    crm_search_contacts: () => ({ contacts: [contato(CONTATO, QUEM_LIGOU)], cursor: null, has_more: false }),
    crm_book_appointment: () => MARCADO,
    crm_reschedule_appointment: () => ({ remarcado: true, compromisso: { ...MARCADO.compromisso, starts_at: "2026-11-20T17:00:00+00:00" } }),
    ...options.tools,
  };
  const mcp = fakeMcp({
    call: (name, args) => ({ content: [{ type: "text", text: JSON.stringify(respostas[name]?.(args as Record<string, unknown>)) }] }),
    override: (rpc: McpRpc, _index, signal) =>
      rpc.method === "tools/call" ? options.quebra?.(String(rpc.params?.name), signal) : undefined,
  });
  const aberturas: { headers: Record<string, string>; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === `${CRM}/api/v1/conversations/open-with-contact`) {
      aberturas.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) });
      return options.abrir?.() ?? json({ data: { conversation_id: "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f55", contact_id: CONTATO_NOVO } });
    }
    return mcp.fetch(input, init);
  };
  const chamadas = () =>
    mcp.requests
      .filter((request) => request.rpc.method === "tools/call")
      .map((request) => ({ tool: request.rpc.params?.name, args: request.rpc.params?.arguments, headers: request.headers }));
  return { fetch, mcp, aberturas, chamadas };
}

function cliente(crm: ReturnType<typeof crmFalso>, config: Partial<DeskcommAgendaConfig> = {}, clock: Clock = { now: () => AGORA }) {
  return createDeskcommAgendaClient(
    { baseUrl: CRM, token: "dsk_teste", ...config },
    { clock, net: { fetch: crm.fetch, lookup: fakeLookup() }, newIdempotencyKey: () => CHAVE },
  );
}

/** Um relógio que só anda quando o teste manda: cada resposta do CRM falso "demora" o que ela quiser. */
function relogio() {
  let passed = 0;
  return {
    clock: { now: () => new Date(AGORA.getTime() + passed) } satisfies Clock,
    /** A resposta `answer`, depois de o relógio andar `ms`. */
    after: (ms: number, answer: unknown) => () => {
      passed += ms;
      return answer;
    },
  };
}

const JANELA = { serviceType: "consulta", from: "2026-11-19T00:00:00-03:00", to: "2026-11-20T00:00:00-03:00", callId: "call-1" };
const MARCAR = { serviceType: "Consulta", startsAt: "2026-11-19T14:00:00-03:00", callerE164: QUEM_LIGOU, callId: "call-1" };

/** Espera a rejeição com o tipo e o motivo certos. Resolver é o fracasso que esta fatia não deixa passar. */
async function rejeita(promise: Promise<unknown>, kind: AgendaErrorKind, refusal?: AgendaRefusal): Promise<AgendaError> {
  const error = await promise.then(
    (value) => {
      throw new Error(`resolveu, e devia rejeitar: ${JSON.stringify(value)}`);
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AgendaError);
  expect((error as AgendaError).kind).toBe(kind);
  if (refusal !== undefined) expect((error as AgendaError).refusal).toBe(refusal);
  return error as AgendaError;
}

describe("cliente da agenda do DeskcommCRM", () => {
  describe("horários livres", () => {
    it("acha o tipo pelo nome, pede os dias que cobrem a janela e devolve só os horários dentro dela", async () => {
      const crm = crmFalso();

      const agenda = await cliente(crm).freeSlots(JANELA);

      expect(agenda).toEqual({
        timezone: "America/Sao_Paulo",
        slots: [{ startsAt: "2026-11-19T17:00:00.000Z", endsAt: "2026-11-19T18:00:00.000Z" }],
        hasMore: false,
        provisional: false,
      });
      // Da terça 12h até a sexta 0h de São Paulo: três dias a partir de agora, e nunca um `dia` montado em UTC.
      expect(crm.chamadas().map(({ tool, args }) => ({ tool, args }))).toEqual([
        { tool: "crm_list_event_types", args: {} },
        { tool: "crm_find_free_slots", args: { event_type_slug: "consulta", dias_a_frente: 3, limite: 50 } },
      ]);
      expect(crm.mcp.requests.every((request) => request.url === `${CRM}/api/mcp` && request.headers.authorization === "Bearer dsk_teste")).toBe(true);
    });

    it("o nome do tipo vale sem acento e sem caixa", async () => {
      const crm = crmFalso();

      await cliente(crm).freeSlots({ ...JANELA, serviceType: "visita de orcamento" });

      expect(crm.chamadas()[1]?.args).toMatchObject({ event_type_slug: "visita-de-orcamento" });
    });

    it("tipo que a organização não tem: recusa sem consultar horário", async () => {
      const crm = crmFalso();

      await rejeita(cliente(crm).freeSlots({ ...JANELA, serviceType: "Botox" }), "refused", "unknown_service");
      expect(crm.chamadas().map(({ tool }) => tool)).toEqual(["crm_list_event_types"]);
    });

    it("agenda sem horário publicado é recusa, e não lista vazia (resposta medida num CRM de verdade)", async () => {
      const crm = crmFalso({
        tools: {
          crm_find_free_slots: () => ({ horarios: [], total_de_horarios: 0, ha_mais: false, fuso_da_regra: "America/Sao_Paulo", publicou_horarios: false, fuso_suposto: true, fontes_defasadas: [], agenda_externa_nunca_lida: false }),
        },
      });

      await rejeita(cliente(crm).freeSlots(JANELA), "refused", "not_published");
    });

    it("a recusa do CRM é traduzida, e o texto dele não sai do cliente (resposta medida num CRM de verdade)", async () => {
      const mensagem = 'Não existe atendimento chamado "consulta". Pergunte à pessoa que tipo de atendimento ela quer.';
      const crm = crmFalso({ tools: { crm_find_free_slots: () => ({ horarios: [], motivo: "tipo_desconhecido", mensagem }) } });

      const error = await rejeita(cliente(crm).freeSlots(JANELA), "refused", "unknown_service");
      expect(error.message).not.toContain("Pergunte");
    });

    it("fuso suposto ou agenda externa nunca lida: horário provisório, e a marcação seguinte é dita como a equipe confirma", async () => {
      for (const marca of [{ fuso_suposto: true }, { agenda_externa_nunca_lida: true }]) {
        const crm = crmFalso({ tools: { crm_find_free_slots: () => ({ ...HORARIOS, ...marca }) } });
        const agenda = cliente(crm);

        expect((await agenda.freeSlots(JANELA)).provisional).toBe(true);
        expect((await agenda.book(MARCAR)).awaitingConfirmation).toBe(true);
        // Outra ligação, sem consulta provisória, não herda a marca.
        expect((await agenda.book({ ...MARCAR, callId: "call-2" })).awaitingConfirmation).toBe(false);
      }
    });

    it("ha_mais chega à ferramenta: lista cortada não é agenda cheia", async () => {
      const crm = crmFalso({ tools: { crm_find_free_slots: () => ({ ...HORARIOS, ha_mais: true }) } });

      expect((await cliente(crm).freeSlots(JANELA)).hasMore).toBe(true);
    });
  });

  describe("marcar", () => {
    it("acha o contato de quem ligou, marca com a chave de idempotência e devolve o compromisso", async () => {
      const crm = crmFalso();

      const marcado = await cliente(crm).book(MARCAR);

      expect(marcado).toEqual({ id: COMPROMISSO, startsAt: "2026-11-19T17:00:00+00:00", awaitingConfirmation: false });
      const chamadas = crm.chamadas();
      expect(chamadas.map(({ tool, args }) => ({ tool, args }))).toEqual([
        { tool: "crm_list_event_types", args: {} },
        { tool: "crm_search_contacts", args: { query: QUEM_LIGOU, limit: 50 } },
        { tool: "crm_book_appointment", args: { event_type_slug: "consulta", starts_at: MARCAR.startsAt, contact_id: CONTATO } },
      ]);
      expect(chamadas[2]?.headers["idempotency-key"]).toBe(CHAVE);
      expect(chamadas[1]?.headers).not.toHaveProperty("idempotency-key");
      expect(crm.aberturas).toEqual([]);
    });

    it("a busca casa por trecho: só o telefone igual depois de normalizado vale", async () => {
      const crm = crmFalso({
        tools: {
          crm_search_contacts: () => ({
            contacts: [contato(OUTRO_CONTATO, "+141555501234"), contato("e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a66", null), contato(CONTATO, "+1 (415) 555-0123")],
            cursor: null,
            has_more: false,
          }),
        },
      });

      await cliente(crm).book(MARCAR);

      expect(crm.chamadas()[2]?.args).toMatchObject({ contact_id: CONTATO });
    });

    it("número novo: cria o contato pelo open-with-contact, no canal escolhido, e marca nele", async () => {
      const crm = crmFalso({ tools: { crm_search_contacts: () => ({ contacts: [contato(OUTRO_CONTATO, "+141555501234")], cursor: null, has_more: false }) } });
      const canal = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c77";

      await cliente(crm, { channelSessionId: canal }).book(MARCAR);

      expect(crm.aberturas).toEqual([{ headers: expect.objectContaining({ authorization: "Bearer dsk_teste" }), body: { phone_number: QUEM_LIGOU, channel_session_id: canal } }]);
      expect(crm.chamadas()[2]?.args).toMatchObject({ contact_id: CONTATO_NOVO });
    });

    it("mais de um contato com o número: não escolhe, não cria e não marca", async () => {
      const crm = crmFalso({
        tools: { crm_search_contacts: () => ({ contacts: [contato(CONTATO, QUEM_LIGOU), contato(OUTRO_CONTATO, "+1 415 555 0123")], cursor: null, has_more: false }) },
      });

      await rejeita(cliente(crm).book(MARCAR), "refused", "ambiguous_contact");
      expect(crm.chamadas().map(({ tool }) => tool)).not.toContain("crm_book_appointment");
      expect(crm.aberturas).toEqual([]);
    });

    it("trechos demais na busca: não cria um contato que pode já existir", async () => {
      const crm = crmFalso({ tools: { crm_search_contacts: () => ({ contacts: [contato(OUTRO_CONTATO, "+141555501234")], cursor: "mais", has_more: true }) } });

      await rejeita(cliente(crm).book(MARCAR), "refused", "ambiguous_contact");
      expect(crm.chamadas().filter(({ tool }) => tool === "crm_search_contacts")).toHaveLength(3);
      expect(crm.aberturas).toEqual([]);
    });

    it("aguarda_confirmacao: a reserva chega como \"a equipe confirma\"", async () => {
      const crm = crmFalso({ tools: { crm_book_appointment: () => ({ ...MARCADO, compromisso: { ...MARCADO.compromisso, status: "pending" }, aguarda_confirmacao: true }) } });

      expect((await cliente(crm).book(MARCAR)).awaitingConfirmation).toBe(true);
    });

    it("o contato não abre: nada é marcado, e a falha é de antes da escrita", async () => {
      const crm = crmFalso({ tools: { crm_search_contacts: () => ({ contacts: [], cursor: null, has_more: false }) }, abrir: () => json({ error: "forbidden" }, 403) });

      await rejeita(cliente(crm).book(MARCAR), "unavailable");
      expect(crm.chamadas().map(({ tool }) => tool)).not.toContain("crm_book_appointment");
    });

    // Cada caso abaixo é um jeito de o CRM não marcar. Um cliente que resolvesse em qualquer um deles
    // seria lido pela ferramenta como horário marcado.
    it.each<[string, Partial<CrmFalsoOptions>, AgendaErrorKind, AgendaRefusal?]>([
      ["HTTP 4xx", { quebra: (tool) => (tool === "crm_book_appointment" ? new Response("{}", { status: 403 }) : undefined) }, "unavailable"],
      ["HTTP 5xx depois do envio", { quebra: (tool) => (tool === "crm_book_appointment" ? new Response("{}", { status: 502 }) : undefined) }, "uncertain"],
      ["isError do MCP", { quebra: (tool) => (tool === "crm_book_appointment" ? { result: { content: [{ type: "text", text: "boom" }], isError: true } } : undefined) }, "uncertain"],
      ["recusa de negócio", { tools: { crm_book_appointment: () => ({ marcado: false, motivo: "agenda_horario_indisponivel", mensagem: "esse horário acabou de ficar indisponível" }) } }, "refused", "slot_unavailable"],
      ["recusa com motivo desconhecido", { tools: { crm_book_appointment: () => ({ marcado: false, motivo: "motivo_novo", mensagem: "x" }) } }, "refused", "other"],
      ["a mesma chave ainda corre", { tools: { crm_book_appointment: () => ({ marcado: false, motivo: "idempotency_in_progress", mensagem: "x" }) } }, "uncertain"],
      ["resultado incerto declarado pelo CRM", { tools: { crm_book_appointment: () => ({ marcado: false, motivo: "agenda_amigo_unconfirmed", resultado_incerto: true, mensagem: "x" }) } }, "uncertain"],
      ["resposta fora da forma", { tools: { crm_book_appointment: () => ({ ok: true }) } }, "uncertain"],
      ["prazo estourado", { quebra: (tool, signal) => (tool === "crm_book_appointment" ? drippingPings(signal) : undefined) }, "uncertain"],
    ])("%s: rejeita", async (_label, options, kind, refusal) => {
      const crm = crmFalso(options);

      await rejeita(cliente(crm, { timeoutSeconds: 0.2 }).book(MARCAR), kind, refusal);
      // Nenhum caso repete a marcação.
      expect(crm.chamadas().filter(({ tool }) => tool === "crm_book_appointment").length).toBeLessThanOrEqual(1);
    });

    it("prazo estourado antes da escrita: indisponível, e a marcação não sai", async () => {
      const crm = crmFalso({ quebra: (tool, signal) => (tool === "crm_search_contacts" ? drippingPings(signal) : undefined) });

      await rejeita(cliente(crm, { timeoutSeconds: 0.2 }).book(MARCAR), "unavailable");
      expect(crm.chamadas().map(({ tool }) => tool)).not.toContain("crm_book_appointment");
    });
  });

  // O prazo é da operação, e não de cada pedido: quem ligou espera a marcação inteira, de três a seis
  // pedidos em série. Com um prazo por pedido, nenhum destes casos cairia.
  describe("um relógio por operação", () => {
    it("a marcação gasta o prazo nos pedidos antes da escrita: a marcação não sai, e é indisponível", async () => {
      const { clock, after } = relogio();
      const crm = crmFalso({
        tools: {
          crm_list_event_types: after(5000, TIPOS),
          crm_search_contacts: after(5000, { contacts: [contato(CONTATO, QUEM_LIGOU)], cursor: null, has_more: false }),
        },
      });

      await rejeita(cliente(crm, { timeoutSeconds: 10 }, clock).book(MARCAR), "unavailable");
      expect(crm.chamadas().map(({ tool }) => tool)).toEqual(["crm_list_event_types", "crm_search_contacts"]);
    });

    it("a busca de contato em várias páginas conta no mesmo relógio", async () => {
      const { clock, after } = relogio();
      const pagina = (cursor: string | null) => ({ contacts: [contato(OUTRO_CONTATO, "+14155550999")], cursor, has_more: cursor !== null });
      let paginas = 0;
      const crm = crmFalso({
        tools: {
          crm_list_event_types: after(3000, TIPOS),
          crm_search_contacts: () => {
            paginas += 1;
            return after(3000, pagina(paginas < 3 ? `c${paginas}` : null))();
          },
        },
      });

      // Tipos (3 s) e duas páginas (6 s): a terceira página ainda sai, com 1 s; depois dela, nada.
      await rejeita(cliente(crm, { timeoutSeconds: 10 }, clock).book(MARCAR), "unavailable");
      expect(crm.chamadas().map(({ tool }) => tool)).toEqual(["crm_list_event_types", "crm_search_contacts", "crm_search_contacts", "crm_search_contacts"]);
      expect(crm.aberturas).toEqual([]);
    });

    it("a consulta gasta o prazo nos tipos: a consulta dos horários não sai", async () => {
      const { clock, after } = relogio();
      const crm = crmFalso({ tools: { crm_list_event_types: after(10_000, TIPOS) } });

      await rejeita(cliente(crm, { timeoutSeconds: 10 }, clock).freeSlots(JANELA), "unavailable");
      expect(crm.chamadas().map(({ tool }) => tool)).toEqual(["crm_list_event_types"]);
    });

    it("o pedido de escrita herda só o que sobra: corta no resto, e o resultado é incerto", async () => {
      // As respostas "demoram" 9,8 s no relógio falso: sobram 200 ms para a marcação, e quem corta
      // nela é o prazo do próprio pedido.
      const { clock, after } = relogio();
      const crm = crmFalso({
        tools: {
          crm_list_event_types: after(4900, TIPOS),
          crm_search_contacts: after(4900, { contacts: [contato(CONTATO, QUEM_LIGOU)], cursor: null, has_more: false }),
        },
        // Ping devagar: o teto de bytes da resposta não corta antes do prazo.
        quebra: (tool, signal) => (tool === "crm_book_appointment" ? drippingPings(signal, 100) : undefined),
      });

      const started = performance.now();
      await rejeita(cliente(crm, { timeoutSeconds: 10 }, clock).book(MARCAR), "uncertain");
      // Com o prazo inteiro por pedido, a marcação esperaria 10 s.
      expect(performance.now() - started).toBeLessThan(3000);
      expect(crm.chamadas().filter(({ tool }) => tool === "crm_book_appointment")).toHaveLength(1);
    });

    it("dentro do prazo, a marcação sai normalmente", async () => {
      const { clock, after } = relogio();
      const crm = crmFalso({
        tools: {
          crm_list_event_types: after(3000, TIPOS),
          crm_search_contacts: after(3000, { contacts: [contato(CONTATO, QUEM_LIGOU)], cursor: null, has_more: false }),
        },
      });

      expect(await cliente(crm, { timeoutSeconds: 10 }, clock).book(MARCAR)).toMatchObject({ id: COMPROMISSO });
    });
  });

  describe("remarcar", () => {
    it("move o compromisso, sem chave de idempotência (o CRM não a repassa na remarcação)", async () => {
      const crm = crmFalso();

      const remarcado = await cliente(crm).reschedule({ appointmentId: COMPROMISSO, startsAt: "2026-11-20T14:00:00-03:00", callId: "call-1" });

      expect(remarcado).toEqual({ id: COMPROMISSO, startsAt: "2026-11-20T17:00:00+00:00", awaitingConfirmation: false });
      const [chamada] = crm.chamadas();
      expect(chamada).toMatchObject({ tool: "crm_reschedule_appointment", args: { appointment_id: COMPROMISSO, new_starts_at: "2026-11-20T14:00:00-03:00" } });
      expect(chamada?.headers).not.toHaveProperty("idempotency-key");
    });

    it("remarcar para o mesmo horário: o CRM devolve só o id, e o horário é o pedido", async () => {
      const crm = crmFalso({ tools: { crm_reschedule_appointment: () => ({ remarcado: true, compromisso: { id: COMPROMISSO, inalterado: true } }) } });

      expect(await cliente(crm).reschedule({ appointmentId: COMPROMISSO, startsAt: "2026-11-20T14:00:00-03:00", callId: "call-1" })).toMatchObject({
        id: COMPROMISSO,
        startsAt: "2026-11-20T14:00:00-03:00",
      });
    });

    it.each<[string, Partial<CrmFalsoOptions>, AgendaErrorKind, AgendaRefusal?]>([
      ["compromisso que não existe", { tools: { crm_reschedule_appointment: () => ({ remarcado: false, motivo: "not_found", mensagem: "x" }) } }, "refused", "appointment_not_found"],
      ["prazo estourado", { quebra: (tool, signal) => (tool === "crm_reschedule_appointment" ? drippingPings(signal) : undefined) }, "uncertain"],
      ["resposta fora da forma", { tools: { crm_reschedule_appointment: () => ({ remarcado: true }) } }, "uncertain"],
    ])("%s: rejeita", async (_label, options, kind, refusal) => {
      await rejeita(cliente(crmFalso(options), { timeoutSeconds: 0.2 }).reschedule({ appointmentId: COMPROMISSO, startsAt: "2026-11-20T14:00:00-03:00", callId: "call-1" }), kind, refusal);
    });
  });

  it("cada cliente fala com o CRM e o token da própria configuração", async () => {
    const crm = crmFalso();

    await cliente(crm, { token: "dsk_org_a" }).freeSlots(JANELA);
    await cliente(crm, { token: "dsk_org_b" }).freeSlots(JANELA);

    const tokens = new Set(crm.mcp.requests.map((request) => request.headers.authorization));
    expect(tokens).toEqual(new Set(["Bearer dsk_org_a", "Bearer dsk_org_b"]));
  });

  it("CRM em endereço privado: a guarda recusa, e nada sai", async () => {
    const crm = crmFalso();

    await rejeita(cliente(crm, { baseUrl: "http://10.0.0.5" }).freeSlots(JANELA), "unavailable");
    expect(crm.mcp.requests).toEqual([]);
  });
});

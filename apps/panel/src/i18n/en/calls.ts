import type { CallsDictionary } from "../pt-BR/calls";

const calls: CallsDictionary = {
  title: "Calls",
  lead: "What your agents are answering now and what they have already answered.",
  simulate: "Simulate a call",
  liveTitle: "Now",
  liveNone: "No call in progress.",
  follow: "Follow",
  historyTitle: "History",
  filterLabel: "Filter by status",
  filterAll: "All",
  emptyFilter: "No call with this status.",
  columns: { caller: "Number", agent: "Agent", status: "Status", started: "Started", duration: "Duration", cost: "Cost" },
  direction: { inbound: "Received", outbound: "Placed by the agent" },
  empty: {
    title: "No calls yet.",
    body: "The steps below are what is left before the first call. Meanwhile, watch the system work with a simulated call: it uses no phone line and no AI key.",
    steps: { agent: "Create an agent", line: "Connect the phone line", engine: "Add the key of a voice engine" },
    done: "Done",
    todo: "To do",
  },
  demoAgent: {
    name: "Demo agent",
    role: "Front desk",
    greeting: "Hello, you have reached the DeskVoice demo.",
    instructions: "Answer warmly and show how DeskVoice works.",
  },
};

export default calls;

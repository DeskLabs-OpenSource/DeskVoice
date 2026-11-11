/**
 * O código que roda na linha de áudio do navegador e entrega cada bloco do microfone à página.
 * Fica como texto e é carregado por Blob: assim ele viaja dentro do próprio pacote do painel e
 * não depende de um arquivo estático estar publicado no caminho certo em cada instalação.
 */
export const CAPTURE_PROCESSOR = "deskvoice-capture";

export const CAPTURE_WORKLET_SOURCE = `
class DeskVoiceCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("${CAPTURE_PROCESSOR}", DeskVoiceCapture);
`;

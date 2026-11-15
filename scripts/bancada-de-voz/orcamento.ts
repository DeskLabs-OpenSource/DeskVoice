/**
 * O teto de gasto da medida. A bancada pergunta antes de cada frase se cabe; se a estimativa do
 * pior caso passar do teto, ela para ali, antes de gastar, e diz onde parou.
 *
 * Com pedidos simultâneos (o Jev com 3 chamadas), perguntar e somar depois não basta: os três
 * perguntam antes de algum somar, e os três passam. Por isso existe a reserva: quem vai gastar
 * reserva a estimativa antes do pedido, e a reserva conta como gasto até ser fechada com o valor
 * real.
 */
export interface Reserva {
  /** Troca a estimativa reservada pelo valor real. Fechar duas vezes não soma de novo. */
  fechar(realUsd: number): void;
}

export class Orcamento {
  private gastoUsd = 0;
  private reservadoUsd = 0;
  private readonly porServicoUsd = new Map<string, number>();

  constructor(readonly tetoUsd: number) {
    if (!(tetoUsd >= 0)) throw new RangeError(`teto inválido: ${tetoUsd}`);
  }

  /** O que já foi gasto, sem as reservas em aberto. */
  get gasto(): number {
    return this.gastoUsd;
  }

  /** Cabe gastar até `estimativaUsd` sem passar do teto, contando as reservas em aberto? */
  cabe(estimativaUsd: number): boolean {
    return this.gastoUsd + this.reservadoUsd + estimativaUsd <= this.tetoUsd;
  }

  /** Reserva `estimativaUsd` se couber; senão, nulo (e nada muda). */
  reservar(estimativaUsd: number, servico?: string): Reserva | null {
    if (!this.cabe(estimativaUsd)) return null;
    this.reservadoUsd += estimativaUsd;
    let aberta = true;
    return {
      fechar: (realUsd) => {
        if (!aberta) return;
        aberta = false;
        this.reservadoUsd -= estimativaUsd;
        this.somar(realUsd, servico);
      },
    };
  }

  /** Soma o que foi gasto. Com `servico`, o gasto também fica separado por serviço. */
  somar(valorUsd: number, servico?: string): void {
    this.gastoUsd += valorUsd;
    if (servico !== undefined) this.porServicoUsd.set(servico, (this.porServicoUsd.get(servico) ?? 0) + valorUsd);
  }

  /** O gasto de cada serviço, na ordem em que gastou pela primeira vez. */
  porServico(): [string, number][] {
    return [...this.porServicoUsd];
  }
}

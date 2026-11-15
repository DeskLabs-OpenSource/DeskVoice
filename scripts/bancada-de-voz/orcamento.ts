/**
 * O teto de gasto da medida. A bancada pergunta antes de cada frase se cabe; se a estimativa do
 * pior caso passar do teto, ela para ali, antes de gastar, e diz onde parou.
 */
export class Orcamento {
  private gastoUsd = 0;
  private readonly porServicoUsd = new Map<string, number>();

  constructor(readonly tetoUsd: number) {
    if (!(tetoUsd >= 0)) throw new RangeError(`teto inválido: ${tetoUsd}`);
  }

  get gasto(): number {
    return this.gastoUsd;
  }

  /** Cabe gastar até `estimativaUsd` sem passar do teto? */
  cabe(estimativaUsd: number): boolean {
    return this.gastoUsd + estimativaUsd <= this.tetoUsd;
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

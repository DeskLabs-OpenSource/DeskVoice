/**
 * O teto de gasto da medida. A bancada pergunta antes de cada frase se cabe; se a estimativa do
 * pior caso passar do teto, ela para ali, antes de gastar, e diz onde parou.
 */
export class Orcamento {
  private gastoUsd = 0;

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

  somar(valorUsd: number): void {
    this.gastoUsd += valorUsd;
  }
}

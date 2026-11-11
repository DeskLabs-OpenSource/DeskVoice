/**
 * Argumentos de um comando chamado por `pnpm run <script> -- --opcao valor`.
 *
 * O pnpm repassa o `--` literal ao script. Para o `parseArgs`, um `--` encerra as opções, e tudo
 * depois dele vira argumento posicional: o comando recusava `--email` como "argumento inesperado".
 * O instalador chama exatamente dessa forma, então sem isto nenhuma instalação criava o primeiro
 * usuário.
 */
export function cliArgs(argv: readonly string[] = process.argv.slice(2)): string[] {
  return argv[0] === "--" ? argv.slice(1) : [...argv];
}

// `import.meta.glob` existe no Turbopack (painel) e no Vite (testes); o TypeScript não conhece nenhum dos dois.
interface ImportMeta {
  glob<T>(patterns: string | string[]): Record<string, () => Promise<T>>;
}

/**
 * Variáveis de ambiente que o produto pode ler. A cerca `env-vars-have-defaults` reprova qualquer
 * outra. Para entrar aqui a variável precisa de uma das duas marcas:
 *
 * - `generated`: o instalador (`install/install.sh`) gera o valor; ninguém digita.
 * - `default`: tem valor padrão (em `loadConfig` ou no ponto de leitura); a instalação sobe sem ela.
 *
 * Configuração que o operador escolhe não é variável de ambiente: mora em `settings` e tem tela.
 */
export const ENV_ALLOWLIST: Record<string, "generated" | "default"> = {
  DATABASE_URL: "generated",
  DESKVOICE_SECRET_KEY: "generated",
  PUBLIC_URL: "generated",
  ARI_PASSWORD: "generated",
  POSTGRES_PASSWORD: "generated",
  // Conexão do papel de sistema (login, fila, roteamento) e o token entre painel e worker de voz:
  // os dois saem de `install/_common.sh`.
  SYSTEM_DATABASE_URL: "generated",
  INTERNAL_TOKEN: "generated",
  // Senhas dos papéis `deskvoice_app` e `deskvoice_system`; só o comando de migrations as recebe.
  APP_DB_PASSWORD: "generated",
  SYSTEM_DB_PASSWORD: "generated",

  ARI_URL: "default",
  ARI_APP: "default",
  ARI_USERNAME: "default",
  AUDIOSOCKET_PORT: "default",
  RTP_START: "default",
  RTP_END: "default",
  PANEL_PORT: "default",
  VOICE_INTERNAL_URL: "default",
  // Opcional: só o comando de migrations recebe a credencial do dono do schema.
  MIGRATION_DATABASE_URL: "default",
  // Definidas pela imagem (Dockerfile) e pelo Node; fora de contêiner valem os padrões.
  APP_VERSION: "default",
  NODE_ENV: "default",
};

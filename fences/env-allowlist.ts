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
  // IP público da VPS, descoberto pelo instalador; vai no `from_domain` dos troncos gerados.
  PUBLIC_IP: "generated",
  // Senhas dos papéis `deskvoice_app` e `deskvoice_system`; só o comando de migrations as recebe.
  // Segredo do agente de atualização (`install/agent.sh`): só com ele a rota do agente responde.
  // Fica em `deploy/.env` e o Compose o entrega só ao painel; voz e rotinas não o recebem.
  UPDATE_AGENT_TOKEN: "generated",
  // Chave com que painel, voz e rotinas falam com o WAHA da instalação (WhatsApp por QR Code). Fica
  // em `deploy/.env`, e o Compose a entrega só a esses três serviços; o WAHA recebe só o hash.
  WAHA_API_KEY: "generated",
  APP_DB_PASSWORD: "generated",
  SYSTEM_DB_PASSWORD: "generated",

  ARI_URL: "default",
  ARI_APP: "default",
  ARI_USERNAME: "default",
  AUDIOSOCKET_PORT: "default",
  RTP_START: "default",
  RTP_END: "default",
  PANEL_PORT: "default",
  // Proxies confiáveis à frente do painel (padrão 0; o instalador grava 1 com o Caddy do DeskVoice recebendo o visitante, 2 atrás do proxy do operador): decide de onde ler o IP do cliente.
  TRUSTED_PROXY_HOPS: "default",
  VOICE_INTERNAL_URL: "default",
  // Porta da API interna do processo de voz (8090) e arquivo de troncos que ele gera para o Asterisk.
  VOICE_INTERNAL_PORT: "default",
  // Porta do WebSocket da chamada pelo navegador (8091), só na rede interna; o Caddy do DeskVoice a entrega em /voice-ws.
  VOICE_WEB_PORT: "default",
  ASTERISK_TRUNKS_FILE: "default",
  // Usuário e grupo do Asterisk dentro do contêiner dele (1000): dono do arquivo de troncos.
  ASTERISK_UID: "default",
  ASTERISK_GID: "default",
  // Opcional: só o comando de migrations recebe a credencial do dono do schema.
  MIGRATION_DATABASE_URL: "default",
  // Definidas pela imagem (Dockerfile) e pelo Node; fora de contêiner valem os padrões.
  APP_VERSION: "default",
  NODE_ENV: "default",
};

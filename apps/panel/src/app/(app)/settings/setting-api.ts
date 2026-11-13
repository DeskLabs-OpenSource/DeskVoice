import { api } from "../../../ui/api";

// Igual em todo idioma: não é frase, é o começo de um endereço.
export const URL_PREFIX = "https://";
export const put = (key: string, value: unknown): Promise<unknown> => api(`/settings/${key}`, { method: "PUT", body: { value } });

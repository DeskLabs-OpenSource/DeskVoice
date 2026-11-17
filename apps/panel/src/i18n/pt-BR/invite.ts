const invite = {
  title: "Você foi convidado",
  lead: "Crie a sua senha para entrar no painel de {organization}.",
  company: "Empresa",
  email: "E-mail",
  role: "Papel",
  name: "Seu nome",
  password: "Senha",
  passwordHint: "No mínimo 10 caracteres.",
  repeat: "Repita a senha",
  mismatch: "As duas senhas não são iguais.",
  submit: "Criar minha conta e entrar",
  invalidTitle: "Este convite não vale mais.",
  invalidBody: "O link pode ter vencido, já ter sido usado ou ter sido cancelado. Peça um convite novo a quem convidou você.",
  signIn: "Já tenho conta: entrar",
  /** O e-mail do convite já tem conta: a pessoa entra com a senha que já usa, e não cria outra. */
  existingLead: "Você já tem conta com {email}. Entre com a senha que você já usa para aceitar o convite de {organization}.",
  existingName: "Seu nome em {organization}",
  existingPassword: "Sua senha",
  existingHint: "A mesma com que você entra no painel.",
  existingSubmit: "Aceitar o convite e entrar",
};

export default invite;
export type InviteDictionary = typeof invite;

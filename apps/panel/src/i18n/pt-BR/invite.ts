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
};

export default invite;
export type InviteDictionary = typeof invite;

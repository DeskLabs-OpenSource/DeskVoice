const invite = {
  title: "Você foi convidado",
  lead: "Para entrar no painel de {organization}, digite a senha duas vezes.",
  company: "Empresa",
  email: "E-mail",
  role: "Papel",
  name: "Seu nome",
  password: "Senha",
  passwordHint: "Se este e-mail já tem conta no DeskVoice, use a senha dela. Se não, escolha uma senha nova, com no mínimo 10 caracteres.",
  repeat: "Repita a senha",
  /** Depois do envio, com a senha recusada: a página pode dizer o caso, sem mudar o formulário. */
  wrongPassword: "Se este e-mail já tem conta, use a senha dela.",
  newPasswordRule: "A senha nova precisa ter no mínimo 10 caracteres.",
  mismatch: "As duas senhas não são iguais.",
  submit: "Aceitar o convite e entrar",
  invalidTitle: "Este convite não vale mais.",
  invalidBody: "O link pode ter vencido, já ter sido usado ou ter sido cancelado. Peça um convite novo a quem convidou você.",
  signIn: "Já tenho conta: entrar",
};

export default invite;
export type InviteDictionary = typeof invite;

import type { InviteDictionary } from "../pt-BR/invite";

const invite: InviteDictionary = {
  title: "You have been invited",
  lead: "Create your password to join the panel of {organization}.",
  company: "Company",
  email: "E-mail",
  role: "Role",
  name: "Your name",
  password: "Password",
  passwordHint: "At least 10 characters.",
  repeat: "Repeat the password",
  mismatch: "The two passwords are not the same.",
  submit: "Create my account and sign in",
  invalidTitle: "This invite is no longer valid.",
  invalidBody: "The link may have expired, been used already or been cancelled. Ask whoever invited you for a new one.",
  signIn: "I already have an account: sign in",
  existingLead: "You already have an account with {email}. Enter the password you already use to accept the invite from {organization}.",
  existingName: "Your name at {organization}",
  existingPassword: "Your password",
  existingHint: "The same one you use to sign in to the panel.",
  existingSubmit: "Accept the invite and sign in",
};

export default invite;

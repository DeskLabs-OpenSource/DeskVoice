import { expect, test } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

// Uma janela de notebook comum, baixa o bastante para o menu em grupos não caber inteiro na lateral.
test.use({ viewport: { width: 1280, height: 720 } });

test("na lateral a 1280×720, o popover do sino abre inteiro, a lateral não rola de lado e o Sair fica à vista", async ({ page }) => {
  await signIn(page);
  await page.goto("/calls");

  const aside = page.locator("aside");
  // O bloco da conta fica fora da rolagem do menu: o Sair aparece sem rolar nada.
  await expect(aside.getByRole("button", { name: common.actions.signOut })).toBeInViewport({ ratio: 1 });

  await aside.locator(`summary[aria-label="${common.shell.notifications}"]`).click();
  const popover = aside.locator("details[open] > div");
  await expect(popover).toBeVisible();

  // Dentro da janela, nas quatro bordas.
  const box = await popover.boundingBox();
  expect(box, "the notifications popover has no box").not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(720);

  // Inteiro: o retângulo não diz se um ancestral com rolagem corta o popover, nem se a tela o cobre,
  // mas o ponto diz. Cada canto e o meio precisam cair no próprio popover, e não na lateral ou na
  // tela. Os cantos ficam 16 px para dentro: o raio do rounded-md é 12 px, e mais rente cairia fora
  // da curva, no que está atrás.
  const inside = await popover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const inset = 16;
    const points: Array<[number, number]> = [
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    return points.map(([x, y]) => element.contains(document.elementFromPoint(x, y)));
  });
  expect(inside).toEqual([true, true, true, true, true]);

  // Nada na lateral rola de lado, nem com o popover aberto.
  const sideways = await aside.evaluate((element) =>
    [element, ...element.querySelectorAll("*")].filter((node) => {
      const style = getComputedStyle(node);
      return node.scrollWidth > node.clientWidth && (style.overflowX === "auto" || style.overflowX === "scroll");
    }).length,
  );
  expect(sideways).toBe(0);
});

// Os endereços de cada item, escritos aqui por extenso: o menu em grupos (parte 1 da central de
// configuração) não podia mudar nenhum, e uma troca de `href` reprova este teste.
const HREFS: Array<[string, string]> = [
  [common.nav.calls, "/calls"],
  [common.nav.approvals, "/approvals"],
  [common.nav.followUps, "/follow-ups"],
  [common.nav.agents, "/agents"],
  [common.nav.line, "/line"],
  [common.nav.outbound, "/outbound"],
  [common.nav.costs, "/costs"],
  [common.nav.team, "/team"],
  [common.nav.settings, "/settings"],
];

test("cada item do menu aponta para o endereço de antes", async ({ page }) => {
  await signIn(page);
  await page.goto("/calls");
  const links = page.locator("aside").getByRole("navigation", { name: common.shell.mainNav }).getByRole("link");
  await expect(links).toHaveCount(HREFS.length);
  // O item de Aprovações pode trazer a contagem ao lado do nome: o nome é conferido pelo começo.
  const read = await links.evaluateAll((items) => items.map((item): [string, string] => [(item.textContent ?? "").replace(/\d+$/, ""), item.getAttribute("href") ?? ""]));
  expect(read).toEqual(HREFS);
});

test("na lateral a 1280×720, a lista do menu rola sozinha: o último item chega à vista sem passar por baixo do bloco da conta", async ({ page }) => {
  await signIn(page);
  await page.goto("/calls");
  const aside = page.locator("aside");
  const last = aside.getByRole("navigation", { name: common.shell.mainNav }).getByRole("link", { name: common.nav.settings });
  await last.scrollIntoViewIfNeeded();
  const item = await last.boundingBox();
  // O bloco de baixo da lateral: o aviso de atualização, a saúde e a conta, que nunca rolam.
  const block = await aside.locator('a[href="/health"]').locator("..").boundingBox();
  expect(item, "the last menu item has no box").not.toBeNull();
  expect(block, "the account block has no box").not.toBeNull();
  if (!item || !block) return;
  // Sem a rolagem na lista, o item fica onde a lista termina, por baixo do bloco da conta.
  expect(item.y + item.height).toBeLessThanOrEqual(block.y);
  // E é ele que recebe o clique no meio dele, e não o que está por cima.
  const hit = await last.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  });
  expect(hit).toBe(true);
});

test("o operador vê Organização só com Configurações, e o bloco da conta com Minha conta", async ({ page }) => {
  const id = unique();
  const email = `operador-${id}@example.test`;
  const password = `senha de teste ${id}`;
  await signIn(page);
  const created = await page.request.post("/api/v1/team/invites", { data: { email, name: `Operador ${id}`, role: "operator" } });
  expect(created.status(), "the owner could not invite an operator").toBe(200);
  const link = ((await created.json()) as { data: { link: string } }).data.link;
  const token = link.split("/invite/")[1] ?? "";
  // Sai da sessão do dono e entra como o operador, pelo aceite do convite, que já abre a sessão dele.
  await page.context().clearCookies();
  const accepted = await page.request.post(`/api/v1/invites/${token}/accept`, { data: { name: `Operador ${id}`, password } });
  expect(accepted.status(), "the operator could not accept the invite").toBe(200);

  await page.goto("/calls");
  const main = page.locator("aside").getByRole("navigation", { name: common.shell.mainNav });
  await expect(main.getByRole("group")).toHaveCount(4);
  await expect(main.getByRole("group", { name: common.navGroups.organization }).getByRole("link")).toHaveText([common.nav.settings]);
  await expect(main.getByRole("link", { name: common.nav.team })).toHaveCount(0);
  await expect(page.locator("aside").getByRole("link", { name: common.shell.myAccount, exact: true })).toHaveAttribute("href", "/settings/account");
});

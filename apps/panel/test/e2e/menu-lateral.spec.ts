import { expect, test } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import { signIn } from "./session";

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

  // Inteiro: o retângulo não diz se um ancestral com rolagem corta o popover, mas o ponto diz. Cada
  // canto (2 px para dentro) e o meio precisam cair no próprio popover, e não na lateral ou na tela.
  const inside = await popover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const points: Array<[number, number]> = [
      [rect.left + 2, rect.top + 2],
      [rect.right - 2, rect.top + 2],
      [rect.left + 2, rect.bottom - 2],
      [rect.right - 2, rect.bottom - 2],
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

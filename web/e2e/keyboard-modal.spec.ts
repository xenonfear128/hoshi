import { test, expect, type Locator, type Page } from "@playwright/test";
import { fixture, noOverflow } from "./fixtures";

// Desktop engines cannot open the native iOS keyboard. Exercise its independent
// visual viewport resize/pan while retaining the original layout viewport.
async function keyboard(
  page: Page,
  height: number,
  offsetTop = 0,
  resizeLayout = false,
) {
  await page.evaluate(
    ({ height, offsetTop, resizeLayout }) => {
      const viewport = window.visualViewport!;
      Object.defineProperties(viewport, {
        height: { configurable: true, get: () => height },
        offsetTop: { configurable: true, get: () => offsetTop },
      });
      if (resizeLayout)
        Object.defineProperty(document.documentElement, "clientHeight", {
          configurable: true,
          get: () => height,
        });
      else Reflect.deleteProperty(document.documentElement, "clientHeight");
      window.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    },
    { height, offsetTop, resizeLayout },
  );
}
async function dismissKeyboard(page: Page) {
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Reflect.deleteProperty(document.documentElement, "clientHeight");
    Reflect.deleteProperty(viewport, "height");
    Reflect.deleteProperty(viewport, "offsetTop");
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
  });
}
async function inEditingArea(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const s = node.closest(".modal-viewport")!.getBoundingClientRect();
        const v = window.visualViewport!;
        return (
          r.top >= Math.max(s.top, v.offsetTop) - 1 &&
          r.bottom <= Math.min(s.bottom, v.offsetTop + v.height) + 1
        );
      }),
    )
    .toBe(true);
}

for (const size of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 700 },
  { width: 1440, height: 900 },
]) {
  for (const theme of ["light", "dark"]) {
    test(`keyboard coverage, focus and restoration ${size.width} ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(size);
      await page.addInitScript(
        (theme) => localStorage.setItem("theme", theme),
        theme,
      );
      await fixture(page);
      await page
        .getByRole("button", { name: "添加主机", exact: true })
        .first()
        .click();
      const modal = page.locator(".host-editor");
      await expect(modal).toBeVisible();
      await modal.evaluate(async (node) => {
        await Promise.all(node.getAnimations().map((a) => a.finished));
      });
      const geometry = () =>
        page.evaluate(() =>
          ["#root", ".ambient-scene", ".nav", ".host-card"].map((selector) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          }),
        );
      const normalPage = await geometry();
      const normalModal = await modal.boundingBox();
      const density = () =>
        modal.evaluate((node) =>
          [
            "header",
            "h2",
            "fieldset",
            "legend",
            "label",
            "input",
            ".modal-scroll",
          ].map((selector) => {
            const s = getComputedStyle(node.querySelector(selector)!);
            return [s.fontSize, s.lineHeight, s.padding, s.margin, s.gap];
          }),
        );
      const normalDensity = await density();
      const password = modal.locator(".credential-input > input");
      await password.fill("test-only-secret");
      await password.focus();
      for (const state of [
        { height: 360, top: 0, resizeLayout: false },
        { height: 190, top: 120, resizeLayout: true },
        { height: 260, top: 64, resizeLayout: true },
      ]) {
        await keyboard(page, state.height, state.top, state.resizeLayout);
        await expect(page.locator("html")).toHaveAttribute(
          "data-keyboard-open",
          "",
        );
        await inEditingArea(password);
        expect(await density()).toEqual(normalDensity);
        expect(await geometry()).toEqual(normalPage);
        await expect
          .poll(() =>
            page.evaluate(() => {
              const r = document
                .querySelector(".overlay-backdrop")!
                .getBoundingClientRect();
              const v = window.visualViewport!;
              const below = document.elementFromPoint(
                4,
                v.offsetTop + v.height + 30,
              );
              return (
                r.top <= 0 &&
                r.bottom >= document.documentElement.clientHeight &&
                below?.classList.contains("overlay-backdrop")
              );
            }),
          )
          .toBe(true);
        const box = (await modal.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(normalModal!.height - 1);
        expect(box.height).toBeGreaterThan(state.height);
        await modal.getByLabel("主机名称", { exact: true }).focus();
        await inEditingArea(modal.getByLabel("主机名称", { exact: true }));
        await password.focus();
        await inEditingArea(password);
      }
      await modal
        .getByRole("button", { name: "显示密码", exact: true })
        .click();
      await expect(password).toHaveAttribute("type", "text");
      await modal
        .getByRole("button", { name: "隐藏密码", exact: true })
        .click();
      await expect(password).toHaveAttribute("type", "password");
      await expect(password).toHaveValue("test-only-secret");
      // Let the focus event from changing the input type settle before the
      // user's next independent scroll gesture.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const scroller = page.locator(".modal-viewport");
      await scroller.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await inEditingArea(
        modal.getByRole("button", { name: "保存主机", exact: true }),
      );
      // Scrolling the content must not displace the glass or trigger a focus
      // correction until the focus/viewport actually changes.
      await expect
        .poll(() =>
          modal.evaluate((node) => {
            const canvas = node.querySelector(".glass-canvas");
            if (!canvas)
              return document.documentElement.dataset.glass === "fallback";
            const a = node.getBoundingClientRect(),
              b = canvas.getBoundingClientRect();
            return (
              Math.abs(a.top - b.top) <= 2 && Math.abs(a.bottom - b.bottom) <= 2
            );
          }),
        )
        .toBe(true);
      await modal.getByRole("button", { name: "关闭", exact: true }).focus();
      await password.focus();
      await inEditingArea(password);
      await page.screenshot({
        path: testInfo.outputPath("keyboard-full-page.png"),
      });
      await page.screenshot({
        path: testInfo.outputPath("keyboard-editing-area.png"),
        clip: { x: 0, y: 64, width: size.width, height: 260 },
      });
      await dismissKeyboard(page);
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-keyboard-open",
      );
      await expect.poll(() => modal.boundingBox()).toEqual(normalModal);
      expect(await geometry()).toEqual(normalPage);
      await noOverflow(page);
      await modal.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(modal).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveAttribute("data-modal-open");
      // No extra document page or scroll introduced after closing the dialog.
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollHeight <= innerHeight + 1 &&
            scrollY === 0,
        ),
      ).toBe(true);
    });
  }
}

test("oversized textarea stays stable in a short landscape viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await fixture(page);
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  const modal = page.locator(".host-editor");
  await modal.getByRole("combobox", { name: "认证方式", exact: true }).click();
  await page.getByRole("option", { name: "SSH 私钥", exact: true }).click();
  const key = modal.getByLabel("私钥", { exact: true });
  await key.focus();
  await keyboard(page, 190, 120);
  await expect
    .poll(() =>
      key.evaluate((node) => {
        const r = node.getBoundingClientRect(),
          s = node.closest(".modal-viewport")!.getBoundingClientRect();
        return r.top < s.bottom && r.bottom > s.top;
      }),
    )
    .toBe(true);
  const scroll = await page
    .locator(".modal-viewport")
    .evaluate((node) => node.scrollTop);
  for (let i = 0; i < 4; i++) {
    await keyboard(page, 190, 120);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(
      await page.locator(".modal-viewport").evaluate((node) => node.scrollTop),
    ).toBe(scroll);
  }
  await dismissKeyboard(page);
  await page.setViewportSize({ width: 700, height: 1280 });
  await expect
    .poll(() =>
      modal.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
      }),
    )
    .toBe(true);
});

test("page scale and both shrinking viewports do not collapse the window", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.addInitScript(() =>
    Object.defineProperty(window.visualViewport!, "scale", {
      configurable: true,
      get: () => 1.1,
    }),
  );
  await fixture(page);
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  const modal = page.locator(".host-editor");
  await modal.evaluate(async (node) =>
    Promise.all(node.getAnimations().map((a) => a.finished)),
  );
  const before = (await modal.boundingBox())!.height;
  const name = modal.getByLabel("主机名称", { exact: true });
  await name.focus();
  await keyboard(page, 190, 0, true);
  await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "");
  await inEditingArea(name);
  expect((await modal.boundingBox())!.height).toBeGreaterThanOrEqual(before);
  expect(
    await page
      .locator("#root")
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBe(700);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const backdrop = getComputedStyle(
          document.querySelector(".overlay-backdrop")!,
        );
        return (
          backdrop.backdropFilter ||
          backdrop.getPropertyValue("-webkit-backdrop-filter")
        ).includes("blur(");
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("first-field-keyboard.png"),
    clip: { x: 0, y: 0, width: 1280, height: 190 },
  });
  await dismissKeyboard(page);
  await expect(page.locator("html")).not.toHaveAttribute("data-keyboard-open");
});

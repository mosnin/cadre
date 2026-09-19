import { expect, test } from "@playwright/test";

test("the agent orb holds still when reduced motion is enabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/avatar-motion.html");

  const orb = page.locator(".cadre-orb");
  await expect(orb).toBeVisible();

  // Two things have to be true, and only the second one used to be checked.
  //
  // A live orb is a WebGL context plus a render loop running every frame.
  // Reduced motion takes neither: the canvas is not mounted at all, so the
  // orb costs nothing and moves not at all, rather than being a moving
  // thing we then try to hold still.
  await expect(orb.locator("canvas")).toHaveCount(0);

  // And the still orb's fallback for "a run is in flight" is a breathing
  // halo, which under reduced motion becomes a fixed ring.
  await expect(orb).toHaveAttribute("data-halo", "true");
  const animationName = await orb.evaluate(
    (element: HTMLElement) => getComputedStyle(element).animationName,
  );
  expect(animationName).toBe("none");
});

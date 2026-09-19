/**
 * Gradient sweep text reveal — viewport trigger and event trigger.
 *
 * `textReveal06` is the upstream contract, unchanged: it scans a scope for
 * `[data-reveal-06]`, resolves per-element options, observes them with a single
 * IntersectionObserver built from every threshold in use, adds `.is-revealed`
 * once, unobserves immediately, and stores its own cleanup on the scope so a
 * re-init cannot stack observers.
 *
 * `revealNow` is the addition Cadre needs. The sweep here is not marking "this
 * scrolled into view", it is marking "this bot just finished" — a moment in
 * time, not a position on a page. So it drives the same `.is-revealed` class
 * and the same CSS, and skips the observer entirely. Everything visual is
 * shared; only the trigger differs.
 */

type RevealOptions = {
  threshold: number;
};

type RevealRoot = (Element | HTMLElement) & {
  textReveal06Destroy?: () => void;
};

const config = {
  threshold: 0.5,
  duration: 1.2,
  delay: 0.1,
};

function applyOptions(element: HTMLElement): RevealOptions {
  const thresholdValue = Number.parseFloat(element.dataset.threshold ?? "");
  const durationValue = Number.parseFloat(element.dataset.duration ?? "");
  const delayValue = Number.parseFloat(element.dataset.delay ?? "");

  const threshold = Number.isNaN(thresholdValue)
    ? config.threshold
    : Math.min(Math.max(thresholdValue, 0), 1);
  const duration = Number.isNaN(durationValue) ? config.duration : Math.max(durationValue, 0);
  const delay = Number.isNaN(delayValue) ? config.delay : Math.max(delayValue, 0);

  element.style.setProperty("--reveal-duration", `${duration}s`);
  element.style.setProperty("--reveal-delay", `${delay}s`);

  // The resting colour has to be a concrete value. `currentColor` would be
  // resolved against the element's own colour, which `.is-revealed` sets to
  // transparent — so the gradient's resting third would be invisible and the
  // text would finish the sweep blank. Read the real colour first, while the
  // element still has one.
  const resting = element.dataset.restingColor ?? (getComputedStyle(element).color || undefined);
  if (resting && resting !== "rgba(0, 0, 0, 0)") {
    element.style.setProperty("--reveal-resting-color", resting);
  }

  return { threshold };
}

/** Viewport-triggered reveal. Returns a cleanup function. */
export function textReveal06(scope: Document | Element = document): () => void {
  const root = (scope === document ? document.documentElement : scope) as RevealRoot;
  const elements = [...scope.querySelectorAll<HTMLElement>("[data-reveal-06]")];

  const settings = new Map<HTMLElement, RevealOptions>(
    elements.map((element) => [element, applyOptions(element)]),
  );

  const thresholds = [...new Set([...settings.values()].map(({ threshold }) => threshold))];

  root.textReveal06Destroy?.();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const options = settings.get(entry.target as HTMLElement);
        if (!options) continue;
        if (!entry.isIntersecting || entry.intersectionRatio < options.threshold) {
          continue;
        }
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      }
    },
    { threshold: thresholds },
  );

  for (const element of elements) {
    if (!element.classList.contains("is-revealed")) {
      observer.observe(element);
    }
  }

  const destroy = () => {
    observer.disconnect();
    if (root.textReveal06Destroy === destroy) {
      delete root.textReveal06Destroy;
    }
  };

  root.textReveal06Destroy = destroy;
  return destroy;
}

/**
 * Event-triggered reveal: run the same sweep on an element right now.
 *
 * `replay` is for reused DOM — a row that swept for an earlier run and has to
 * sweep again for a new one. It clears the state class, forces a reflow so the
 * browser sees the removal as a separate frame, then re-adds it; without the
 * reflow the class churn collapses into one style recalculation and nothing
 * animates.
 */
export function revealNow(
  element: HTMLElement | null | undefined,
  { replay = false }: { replay?: boolean } = {},
): void {
  if (!element) return;
  applyOptions(element);

  if (element.classList.contains("is-revealed")) {
    if (!replay) return;
    element.classList.remove("is-revealed");
    void element.offsetWidth;
  }

  element.classList.add("is-revealed");
}

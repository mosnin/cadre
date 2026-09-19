type NumberFlowDisplay = HTMLElement & {
  format: Intl.NumberFormatOptions;
  animated: boolean;
  update: (value: number) => void;
};

type Spring = { stiffness: number; damping: number; mass: number };

function isNumberFlowDisplay(node: Element | null): node is NumberFlowDisplay {
  return (
    node instanceof HTMLElement &&
    "update" in node &&
    typeof (node as NumberFlowDisplay).update === "function"
  );
}

function rangeSlider01(scope: ParentNode = document) {
  const sliders = [...scope.querySelectorAll<HTMLElement>("[data-range-slider]")];

  sliders.forEach((slider) => {
    if (slider.dataset.rangeSliderReady === "true") return;
    slider.dataset.rangeSliderReady = "true";

    const control = slider.querySelector<HTMLElement>("[data-slider-control]");
    const track = slider.querySelector<HTMLElement>("[data-slider-track]");
    const fill = slider.querySelector<HTMLElement>("[data-slider-fill]");
    const ticks = slider.querySelector<HTMLElement>("[data-slider-ticks]");
    const thumb = slider.querySelector<HTMLElement>("[data-slider-thumb]");
    const display = slider.querySelector("[data-slider-value]");
    if (!control || !track || !fill || !ticks || !thumb || !isNumberFlowDisplay(display)) return;

    const clamp = (number: number, minimum: number, maximum: number) =>
      Math.min(maximum, Math.max(minimum, number));
    const readNumber = (name: "min" | "max" | "step" | "value", fallback: number) => {
      const number = Number(slider.dataset[name]);
      return Number.isFinite(number) ? number : fallback;
    };

    const minimum = readNumber("min", 0);
    const suppliedMaximum = readNumber("max", 100);
    const maximum = suppliedMaximum > minimum ? suppliedMaximum : minimum;
    const suppliedStep = readNumber("step", 1);
    const step = suppliedStep > 0 ? suppliedStep : 1;
    const initialValue = clamp(readNumber("value", minimum), minimum, maximum);
    const range = maximum - minimum;

    const snap = (next: number) => {
      if (!(maximum > minimum)) return minimum;

      const wholeSteps = Math.floor(Number(((maximum - minimum) / step).toFixed(6)));
      const lastWholeStep = Number((minimum + wholeSteps * step).toFixed(6));
      const gridValue = clamp(
        Math.round((next - minimum) / step) * step + minimum,
        minimum,
        lastWholeStep,
      );
      const snapped =
        lastWholeStep < maximum && Math.abs(next - maximum) <= Math.abs(next - gridValue)
          ? maximum
          : gridValue;

      return Number(snapped.toFixed(6));
    };

    const toPercent = (next: number) => (range > 0 ? ((next - minimum) / range) * 100 : 0);
    const formatValue = (next: number) => String(Number(next.toFixed(6)));

    let value = snap(initialValue);
    let targetPercent = toPercent(value);
    let visualPercent = targetPercent;
    let percentVelocity = 0;
    let thumbScale = 1;
    let scaleVelocity = 0;
    let edgeStretch = 0;
    let stretchVelocity = 0;
    let dragging = false;
    let pointerId: number | null = null;
    let dragBounds: DOMRect | null = null;
    let dragStartValue = value;
    let animationFrame = 0;
    let previousTime = performance.now();

    const grabScale = 1.34;
    const resistance = { slack: 29, reach: 198, stretch: 9 };
    const springs = {
      position: { stiffness: 702, damping: 50, mass: 0.5 },
      thumb: { stiffness: 502, damping: 14, mass: 0.7 },
      edge: { stiffness: 280, damping: 18, mass: 0.8 },
    };

    display.format = { maximumFractionDigits: 6 };
    display.animated = false;

    const stepSpring = (
      position: number,
      velocity: number,
      target: number,
      spring: Spring,
      delta: number,
    ): [number, number] => {
      const force = spring.stiffness * (target - position);
      const damping = spring.damping * velocity;
      const acceleration = (force - damping) / spring.mass;
      const nextVelocity = velocity + acceleration * delta;

      return [position + nextVelocity * delta, nextVelocity];
    };

    const render = () => {
      const percent = clamp(visualPercent, 0, 100);
      const safeScale = Math.max(0.8, thumbScale);
      const stretch = edgeStretch;

      fill.style.width = `${percent}%`;
      thumb.style.left = `${percent}%`;
      thumb.style.transform = `translate3d(-50%, -50%, 0) scaleY(${safeScale})`;
      track.style.width = `calc(100% + ${Math.abs(stretch)}px)`;
      track.style.transform = `translate3d(${Math.min(stretch, 0)}px, 0, 0)`;
    };

    const isMoving = () =>
      Math.abs(targetPercent - visualPercent) > 0.001 ||
      Math.abs(percentVelocity) > 0.001 ||
      Math.abs((dragging ? grabScale : 1) - thumbScale) > 0.001 ||
      Math.abs(scaleVelocity) > 0.001 ||
      (!dragging && (Math.abs(edgeStretch) > 0.001 || Math.abs(stretchVelocity) > 0.001));

    const animate = (time: number) => {
      const elapsed = Math.min((time - previousTime) / 1000, 1 / 30);
      previousTime = time;
      const substeps = Math.max(1, Math.ceil(elapsed / (1 / 120)));
      const delta = elapsed / substeps;

      for (let index = 0; index < substeps; index += 1) {
        [visualPercent, percentVelocity] = stepSpring(
          visualPercent,
          percentVelocity,
          targetPercent,
          springs.position,
          delta,
        );
        [thumbScale, scaleVelocity] = stepSpring(
          thumbScale,
          scaleVelocity,
          dragging ? grabScale : 1,
          springs.thumb,
          delta,
        );

        if (!dragging) {
          [edgeStretch, stretchVelocity] = stepSpring(
            edgeStretch,
            stretchVelocity,
            0,
            springs.edge,
            delta,
          );
        }
      }

      render();
      if (isMoving()) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        visualPercent = targetPercent;
        percentVelocity = 0;
        thumbScale = dragging ? grabScale : 1;
        scaleVelocity = 0;
        if (!dragging) {
          edgeStretch = 0;
          stretchVelocity = 0;
        }
        animationFrame = 0;
        render();
      }
    };

    const requestAnimation = () => {
      if (animationFrame) return;
      previousTime = performance.now();
      animationFrame = requestAnimationFrame(animate);
    };

    const updateValue = (next: number, eventName = "input") => {
      const snapped = snap(clamp(next, minimum, maximum));
      const changed = snapped !== value;
      value = snapped;
      targetPercent = toPercent(value);
      slider.dataset.value = formatValue(value);
      display.update(value);
      thumb.setAttribute("aria-valuemin", formatValue(minimum));
      thumb.setAttribute("aria-valuemax", formatValue(maximum));
      thumb.setAttribute("aria-valuenow", formatValue(value));
      thumb.setAttribute("aria-valuetext", formatValue(value));

      if (changed) {
        slider.dispatchEvent(
          new CustomEvent(eventName, {
            bubbles: true,
            detail: { value },
          }),
        );
      }

      requestAnimation();
    };

    const updateFromPointer = (event: PointerEvent) => {
      if (!dragBounds || dragBounds.width === 0) return;

      const ratio = clamp((event.clientX - dragBounds.left) / dragBounds.width, 0, 1);
      const pointerValue = minimum + ratio * range;
      const next = event.shiftKey
        ? dragStartValue + (pointerValue - dragStartValue) * 0.22
        : pointerValue;
      updateValue(next);

      const direction =
        event.clientX < dragBounds.left ? -1 : event.clientX > dragBounds.right ? 1 : 0;

      if (!direction) {
        edgeStretch = 0;
        stretchVelocity = 0;
      } else {
        const outside =
          direction < 0 ? dragBounds.left - event.clientX : event.clientX - dragBounds.right;
        const resisted = Math.max(0, outside - resistance.slack);
        edgeStretch =
          direction * resistance.stretch * Math.sqrt(Math.min(resisted / resistance.reach, 1));
        stretchVelocity = 0;
      }

      render();
    };

    const endDrag = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;

      try {
        if (control.hasPointerCapture(event.pointerId)) {
          control.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Pointer capture can already be gone on touch devices.
      }

      dragging = false;
      pointerId = null;
      dragBounds = null;
      slider.classList.remove("is-active");
      slider.dispatchEvent(
        new CustomEvent("change", {
          bubbles: true,
          detail: { value },
        }),
      );
      requestAnimation();
    };

    control.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      pointerId = event.pointerId;
      dragBounds = control.getBoundingClientRect();
      dragStartValue = value;
      slider.classList.add("is-active");
      slider.classList.add("is-pointer-input");
      thumb.focus({ preventScroll: true });

      try {
        control.setPointerCapture(event.pointerId);
      } catch {
        // Touch pointers still have implicit capture when explicit capture fails.
      }

      updateFromPointer(event);
      requestAnimation();
    });

    control.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      updateFromPointer(event);
    });
    control.addEventListener("pointerup", endDrag);
    control.addEventListener("pointercancel", endDrag);
    control.addEventListener("lostpointercapture", endDrag);

    thumb.addEventListener("keydown", (event) => {
      slider.classList.remove("is-pointer-input");
      const values: Record<string, number> = {
        ArrowRight: value + step,
        ArrowUp: value + step,
        ArrowLeft: value - step,
        ArrowDown: value - step,
        PageUp: value + step * 10,
        PageDown: value - step * 10,
        Home: minimum,
        End: maximum,
      };

      const next = values[event.key];
      if (next === undefined) return;
      event.preventDefault();
      updateValue(next, "change");
    });

    thumb.addEventListener("blur", () => {
      slider.classList.remove("is-pointer-input");
    });

    const wholeSteps = Math.floor(Number(((maximum - minimum) / step).toFixed(6)));

    if (wholeSteps > 0 && wholeSteps <= 50) {
      const fragment = document.createDocumentFragment();

      for (let index = 0; index <= wholeSteps; index += 1) {
        const tick = document.createElement("span");
        const tickValue = Number((minimum + index * step).toFixed(6));
        tick.style.left = `${toPercent(tickValue)}%`;
        fragment.append(tick);
      }

      ticks.append(fragment);
    }

    updateValue(value);
    display.animated = true;
    visualPercent = targetPercent;
    percentVelocity = 0;
    render();
  });
}

export { rangeSlider01 };

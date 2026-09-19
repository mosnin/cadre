import { useEffect, useId, useRef } from "react";
import "number-flow";
import { rangeSlider01 } from "../lib/range-slider-01";
import "./elastic-range-slider.css";

function readSliderValue(event: Event): number | null {
  if (!(event instanceof CustomEvent)) return null;
  const value = event.detail && typeof event.detail === "object" ? event.detail.value : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function ElasticRangeSlider({
  min,
  max,
  step,
  value,
  label,
  onValueInput,
  onValueChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  label: string;
  onValueInput?: (value: number) => void;
  onValueChange?: (value: number) => void;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    rangeSlider01(scope);
  }, []);

  useEffect(() => {
    const slider = scopeRef.current?.querySelector("[data-range-slider]");
    if (!slider) return;

    const handleInput = (event: Event) => {
      const next = readSliderValue(event);
      if (next != null) onValueInput?.(next);
    };
    const handleChange = (event: Event) => {
      const next = readSliderValue(event);
      if (next != null) onValueChange?.(next);
    };

    slider.addEventListener("input", handleInput);
    slider.addEventListener("change", handleChange);
    return () => {
      slider.removeEventListener("input", handleInput);
      slider.removeEventListener("change", handleChange);
    };
  }, [onValueChange, onValueInput]);

  return (
    <div ref={scopeRef}>
      <div
        className="range-slider"
        data-range-slider
        data-min={String(min)}
        data-max={String(max)}
        data-step={String(step)}
        data-value={String(value)}
        data-testid="elastic-range-slider"
      >
        <div className="meta">
          <span id={labelId} className="label">
            {label}
          </span>
          <number-flow className="value" data-slider-value data-will-change />
        </div>

        <div className="control" data-slider-control>
          <div className="track" data-slider-track>
            <div className="track-clip">
              <div className="fill" data-slider-fill />
            </div>

            <div className="ticks" data-slider-ticks aria-hidden="true" />

            <div
              className="thumb"
              data-slider-thumb
              role="slider"
              tabIndex={0}
              aria-labelledby={labelId}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value}
            >
              <span className="thumb-mark" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import type { ThinkingLevel } from "@cadre/contracts";

export function thinkingSliderIndex(options: readonly ThinkingLevel[], current: string): number {
  if (current) {
    const index = options.indexOf(current as ThinkingLevel);
    if (index >= 0) return index;
  }
  const medium = options.indexOf("medium");
  if (medium >= 0) return medium;
  return options.length > 0 ? Math.floor((options.length - 1) / 2) : 0;
}

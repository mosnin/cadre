/**
 * Measured geometry for the workspace home.
 *
 * Every number was read off the reference screenshots at 1920px and divided by
 * 1.27 to reach the 1512px render they were upscaled from; the working is in
 * `docs/shell-measurements.md`. They are constants rather than
 * Tailwind classes so changing one is changing a measured value, not editing a
 * string buried in markup.
 */
export const HOME = {
  /** The centred column the composer and the list share. */
  columnWidth: 868,
  /**
   * The column is bottom-anchored, not centred: it ends 52px above the foot of
   * the pane so a conversation can grow above it. Centring put the composer
   * 175px too high on an empty screen.
   */
  columnBottomGap: 34,

  composerHeight: 85,
  composerRadius: 18,
  composerFontSize: 15,

  /** Composer foot to the first separator, holding the Create/Sources row. */
  metaRowHeight: 34,
  metaFontSize: 12.5,
  listGap: 20,

  /** Row box, which the 1px separator above it brings to the measured 61. */
  suggestionPitch: 60,
  suggestionFontSize: 13.5,
  suggestionIconSize: 15,
  suggestionAvatarSize: 20,
} as const;

/** Rail geometry, shared with the navigator. */
export const RAIL = {
  width: 268,
  navPitch: 38,
  navFontSize: 13.5,
  navIconSize: 15,
  sectionFontSize: 11,
} as const;

/**
 * Measured geometry for the Sana-derived shell.
 *
 * Every number here was read off the reference screenshots at 1920px and
 * divided by 1.27 to reach the 1512px render they were upscaled from. The
 * working is in `docs/design/sana-shell-measurements.md`. They are written as
 * constants rather than Tailwind classes so a change is a change to a measured
 * value, not to a string buried in markup.
 */
export const SHELL = {
  /** Left rail, fixed. */
  railWidth: 268,
  railBg: "#f9f9f9",
  paneBg: "#ffffff",

  /** Workspace switcher block above the nav. */
  /** 44 in the reference; 56 here because Cadre's switcher carries a subtitle. */
  workspaceHeight: 56,

  /** Primary nav rows. */
  navPitch: 38,
  navFontSize: 13.5,
  navIconSize: 15,

  /** Bot avatars in the rail, sized to the nav row. */
  botAvatarSize: 20,

  /** Section labels above a group ("Bots", "Today"). */
  sectionFontSize: 11,

  /** Composer. */
  composerWidth: 868,
  composerHeight: 85,
  composerFill: "#f3f3f3",
  composerFontSize: 15,

  /** Suggestion list beneath the composer. */
  suggestionPitch: 61,
  suggestionFontSize: 13.5,

  /**
   * The composer column is bottom-anchored, not centred: in the reference it
   * ends 62px above the foot of the pane so a conversation can grow above it.
   * Centring it put the composer 175px too high on an empty screen.
   */
  columnBottomGap: 52,

  /**
   * Composer bottom to the first suggestion separator: 54px in the reference,
   * holding the Create/Sources row. Ours ran 114 because the row's buttons
   * carried their own padding.
   */
  metaRowHeight: 34,
  listGap: 20,

  /** Footer block in the rail. */
  primaryButton: "#0b1418",
  primaryButtonHeight: 35,
} as const;

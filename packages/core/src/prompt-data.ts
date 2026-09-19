/**
 * Untrusted text reaches a model inside a delimited block. Escaping the angle brackets and
 * ampersands keeps that text from opening or closing any delimiter around it, so page
 * content, a tool result, or another member's saved value cannot forge a section of the
 * prompt. Every caller that interpolates data into a prompt uses this one function.
 */
export function escapePromptData(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Collapse a value onto one line so it cannot forge extra entries in a line-oriented list. */
export function oneLine(value: string): string {
  return value.replaceAll("\r", " ").replaceAll("\n", " ").trim();
}

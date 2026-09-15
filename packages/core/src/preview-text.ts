/** Plain text for single-line conversation previews, including truncated Markdown. */
export function conversationPreview(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:#{1,6} |>|[-*+] )/gm, "")
    .replace(/\*\*|__|~~|`+/g, "")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ChippiHost {
  kind?: "personal" | "team" | "brokerage";
  basePath: string;
  apiBase: string;
  crmHref: string;
  name: string;
  role: string;
  workspaces?: { kind?: "personal" | "team" | "brokerage"; href: string; name: string; role: string }[];
}
export function chippiHost(): ChippiHost | null {
  if (typeof document === "undefined") return null;
  const node = document.getElementById("chippi-host");
  if (!node?.textContent) return null;
  return JSON.parse(node.textContent) as ChippiHost;
}
export function hostedApiPath(path: string): string {
  const host = chippiHost();
  return host && path.startsWith("/") && !path.startsWith("//") ? host.apiBase + path : path;
}

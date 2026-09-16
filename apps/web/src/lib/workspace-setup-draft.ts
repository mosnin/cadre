export type WorkspaceSetupDraft = {
  step: "workspace" | "company" | "model" | "bot";
  workspaceName: string;
  name: string;
  title: string;
  description: string;
  createdWorkspaceId?: string;
  savedAt: number;
};

const MAX_AGE = 24 * 60 * 60 * 1000;
export function setupDraftKey(userId: string, spaceId: string) {
  return `cadre:setup:${userId}:${spaceId}`;
}

export function readSetupDraft(key: string): WorkspaceSetupDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      !value ||
      typeof value.savedAt !== "number" ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > Date.now() ||
      Date.now() - value.savedAt > MAX_AGE
    )
      return null;
    if (!["workspace", "company", "model", "bot"].includes(value.step)) return null;
    for (const field of ["workspaceName", "name", "title", "description"]) {
      if (typeof value[field] !== "string" || value[field].length > 10000) return null;
    }
    if (value.createdWorkspaceId !== undefined && typeof value.createdWorkspaceId !== "string")
      return null;
    return value;
  } catch {
    return null;
  }
}

export function saveSetupDraft(key: string, draft: WorkspaceSetupDraft | null) {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    // Storage is a convenience. A blocked store must not block setup.
  }
}

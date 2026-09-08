export interface ComputerScreenResult {
  url: string | null;
  error: string | null;
  sharedInput?: boolean;
}

/** Only the latest request for the visible computer may replace its screen or error. */
export async function loadComputerScreen(options: {
  load: () => Promise<{ url: string | null; sharedInput?: boolean }>;
  isCurrent: () => boolean;
  commit: (result: ComputerScreenResult) => void;
  fallbackError: string;
  previousUrl?: string | null;
  previousSharedInput?: boolean;
}): Promise<string | null> {
  let result: ComputerScreenResult;
  try {
    const screen = await options.load();
    result = {
      url: screen.url,
      error: null,
      ...(screen.sharedInput === undefined ? {} : { sharedInput: screen.sharedInput }),
    };
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error ? error.status : undefined;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const denied =
      status === 401 ||
      status === 403 ||
      status === 404 ||
      code === "UNAUTHORIZED" ||
      code === "FORBIDDEN" ||
      code === "NOT_FOUND";
    // An API status failure does not imply that the independent RFB stream failed.
    if (options.previousUrl && !denied) {
      if (options.isCurrent())
        options.commit({
          url: options.previousUrl,
          error: null,
          ...(options.previousSharedInput === undefined
            ? {}
            : { sharedInput: options.previousSharedInput }),
        });
      return options.isCurrent() ? options.previousUrl : null;
    }
    result = {
      url: null,
      error: error instanceof Error && error.message ? error.message : options.fallbackError,
    };
  }
  if (!options.isCurrent()) return null;
  options.commit(result);
  return result.url;
}

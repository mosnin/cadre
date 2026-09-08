export function hasDesktopFrame(
  canvas: {
    width: number;
    height: number;
    getContext(type: string): {
      getImageData(
        x: number,
        y: number,
        width: number,
        height: number,
      ): { data: ArrayLike<number> };
    };
  } | null,
): boolean;
export function createViewerConnection(options: {
  connect: (events: { connected(): void; disconnected(): void }) => { disconnect(): void };
  status: (state: "connecting" | "connected" | "reconnecting" | "failed") => void;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}): { retry(): void; dispose(): void };

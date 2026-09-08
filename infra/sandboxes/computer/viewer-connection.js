// The noVNC canvas starts transparent; an opaque pixel is evidence of a decoded
// framebuffer, including a legitimately black desktop. DOM/VM readiness is not.
export function hasDesktopFrame(canvas) {
  if (!canvas?.width || !canvas?.height) return false;
  try {
    return (
      canvas
        .getContext("2d")
        .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3] ===
      255
    );
  } catch {
    return false;
  }
}

// Reconnect only the viewer transport. A failed stream must never restart a desktop.
export function createViewerConnection({
  connect,
  status,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let current,
    retryTimer,
    connectTimer,
    disposed = false,
    failures = 0,
    generation = 0;
  function clearTimers() {
    cancel(retryTimer);
    cancel(connectTimer);
  }
  function start() {
    if (disposed) return;
    clearTimers();
    const attempt = ++generation;
    current?.disconnect();
    current = undefined;
    status(failures ? "reconnecting" : "connecting");
    const failed = () => {
      if (disposed || attempt !== generation) return;
      ++generation;
      clearTimers();
      current?.disconnect();
      current = undefined;
      failures++;
      if (failures > 5) {
        status("failed");
        return;
      }
      status("reconnecting");
      retryTimer = schedule(start, Math.min(1000 * 2 ** (failures - 1), 10000));
    };
    try {
      current = connect({
        connected() {
          if (disposed || attempt !== generation) return;
          cancel(connectTimer);
          status("connected");
          // A brief connect/disconnect cycle must not create an endless retry loop.
          retryTimer = schedule(() => {
            failures = 0;
          }, 30000);
        },
        disconnected: failed,
      });
      connectTimer = schedule(failed, 20000);
    } catch {
      failed();
    }
  }
  start();
  return {
    retry() {
      failures = 0;
      start();
    },
    dispose() {
      disposed = true;
      ++generation;
      clearTimers();
      current?.disconnect();
      current = undefined;
    },
  };
}

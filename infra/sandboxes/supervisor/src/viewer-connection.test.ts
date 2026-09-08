import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewerConnection, hasDesktopFrame } from "../../computer/viewer-connection.js";

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const attempts: Array<{ connected(): void; disconnected(): void }> = [];
  const disconnect = vi.fn();
  const status = vi.fn();
  const viewer = createViewerConnection({
    connect(events) {
      attempts.push(events);
      return { disconnect };
    },
    status,
  });
  return { attempts, disconnect, status, viewer };
}

describe("desktop stream recovery", () => {
  it("waits for a decoded framebuffer, accepting black pixels but not a blank canvas", () => {
    const canvas = {
      width: 1280,
      height: 800,
      getContext: () => ({ getImageData: () => ({ data: [0, 0, 0, 0] }) }),
    };
    expect(hasDesktopFrame(canvas)).toBe(false);
    canvas.getContext = () => ({ getImageData: () => ({ data: [0, 0, 0, 255] }) });
    expect(hasDesktopFrame(canvas)).toBe(true);
    expect(hasDesktopFrame(null)).toBe(false);
  });
  it("shows startup, recovers transport loss, and ignores stale connection events", () => {
    const { attempts, status, viewer } = setup();
    expect(status).toHaveBeenLastCalledWith("connecting");
    attempts[0]!.connected();
    expect(status).toHaveBeenLastCalledWith("connected");
    attempts[0]!.disconnected();
    expect(status).toHaveBeenLastCalledWith("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(attempts).toHaveLength(2);
    attempts[0]!.connected();
    attempts[0]!.disconnected();
    expect(status).toHaveBeenLastCalledWith("reconnecting");
    attempts[1]!.connected();
    expect(status).toHaveBeenLastCalledWith("connected");
    viewer.dispose();
    vi.runAllTimers();
    expect(attempts).toHaveLength(2);
  });

  it("bounds repeated failures even when the server briefly connects each time", () => {
    const { attempts, status, viewer } = setup();
    for (let i = 0; i < 6; i++) {
      attempts[i]!.connected();
      attempts[i]!.disconnected();
      vi.advanceTimersByTime(Math.min(1000 * 2 ** i, 10000));
    }
    expect(attempts).toHaveLength(6);
    expect(status).toHaveBeenLastCalledWith("failed");
    vi.runAllTimers();
    expect(attempts).toHaveLength(6);
    viewer.retry();
    expect(attempts).toHaveLength(7);
    viewer.dispose();
  });

  it("times out a socket that never completes its RFB handshake", () => {
    const { attempts, disconnect, status, viewer } = setup();
    vi.advanceTimersByTime(20000);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(attempts).toHaveLength(2);
    viewer.dispose();
  });

  it("allows recovery again after a stable connection", () => {
    const { attempts, status, viewer } = setup();
    for (let i = 0; i < 8; i++) {
      attempts[i]!.connected();
      vi.advanceTimersByTime(30000);
      attempts[i]!.disconnected();
      vi.advanceTimersByTime(1000);
    }
    expect(status).not.toHaveBeenCalledWith("failed");
    viewer.dispose();
  });
});

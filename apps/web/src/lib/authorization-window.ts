/** Reserve the popup during the click gesture, before authorization RPC latency. */
export function reserveAuthorizationWindow(needed = true) {
  const popup = needed ? window.open("about:blank", "_blank", "popup,width=560,height=720") : null;
  if (popup) popup.opener = null;
  let navigated = false;
  return {
    navigate(url: string) {
      const target = new URL(url);
      if (target.protocol !== "https:") throw new Error("Invalid authorization URL.");
      navigated = true;
      if (popup && !popup.closed) popup.location.replace(target.href);
      else window.location.assign(target.href);
    },
    closeUnused() {
      if (!navigated) popup?.close();
    },
  };
}

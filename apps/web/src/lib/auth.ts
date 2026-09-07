import { genericOAuthClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { chippiHost } from "./chippi-host";

export const authClient = createAuthClient({
  ...(chippiHost()
    ? { baseURL: window.location.origin, basePath: `${chippiHost()!.apiBase}/api/auth` }
    : {}),
  plugins: [organizationClient(), genericOAuthClient()],
});

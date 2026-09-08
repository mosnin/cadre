import { Trans } from "@lingui/react/macro";

export function ChatGptDeviceCodeHelp({ provider }: { provider: string }) {
  if (provider !== "openai-codex") return null;
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      <Trans>
        Enable device code login in ChatGPT security settings or your workspace permissions.{" "}
        <a
          href="https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta"
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline"
        >
          Sign-in help
        </a>
      </Trans>
    </p>
  );
}

import { Trans } from "@lingui/react/macro";

/** Short path when computers are off (none) or Docker is misconfigured. */
export function ComputersUnavailableHint({ className }: { className?: string }) {
  return (
    <p data-testid="computers-unavailable-hint" className={className}>
      <Trans>
        Computers are off. Set SANDBOX_PROVIDER=docker with SANDBOX_SUPERVISOR_TOKEN, set it to
        device so bots run on your own Mac or Linux machine through Burst, or set it to e2b,
        daytona, or box with its API key. Recreate the stack after changing .env.
      </Trans>
    </p>
  );
}

export function computersAreUnavailable(sandboxProvider: string | null | undefined) {
  return sandboxProvider === "none" || sandboxProvider === "";
}

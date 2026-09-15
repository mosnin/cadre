import { Trans } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";

export function BotCreatePicker({
  onCreateBot,
  onCreateGroup,
  onCreateSpace,
}: {
  onCreateBot: () => void;
  onCreateGroup: () => void;
  onCreateSpace: () => void;
}) {
  return (
    <div data-testid="bot-create-picker" className="grid w-60 gap-1 p-2">
      <Button
        variant="ghost"
        className="justify-start"
        data-testid="create-new-bot"
        onClick={onCreateBot}
      >
        <Trans>New agent</Trans>
      </Button>
      <Button
        variant="ghost"
        className="justify-start"
        data-testid="create-new-group"
        onClick={onCreateGroup}
      >
        <Trans>New group chat</Trans>
      </Button>
      <Button
        variant="ghost"
        className="justify-start"
        data-testid="create-new-space"
        onClick={onCreateSpace}
      >
        <Trans>New workspace</Trans>
      </Button>
    </div>
  );
}

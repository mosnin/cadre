import type { Bot } from "@cadre/contracts";
import { BotAvatar } from "@cadre/ui-web";
import { CommandPalette as DirectoryCommandPalette } from "@cadre/ui-web/directory/command-palette";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";

export function CommandPalette({
  open,
  onOpenChange,
  bots,
  onSelectBot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: Bot[];
  onSelectBot: (botId: string) => void;
}) {
  const items = useMemo(
    () =>
      bots.map((bot) => ({
        id: bot.id,
        label: bot.name,
        group: t`Agents`,
        keywords: [bot.title, bot.description, bot.preview],
        testId: `command-palette-bot-${bot.id}`,
        content: (
          <span className="flex min-w-0 items-center gap-3">
            <BotAvatar color={bot.color} identity={bot.id} size={32} status={bot.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" dir="auto">
                {bot.name}
              </span>
              <span className="block truncate text-sm text-muted-foreground" dir="auto">
                {bot.description.trim() || bot.preview.trim() || bot.title.trim()}
              </span>
            </span>
          </span>
        ),
        onSelect: () => onSelectBot(bot.id),
      })),
    [bots, onSelectBot],
  );
  return (
    <DirectoryCommandPalette
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      shortcut={null}
      numberShortcuts
      ariaLabel={t`Switch agent`}
      closeLabel={t`Close search`}
      placeholder={t`Search`}
      emptyMessage={t`No agents found`}
    />
  );
}
export { isCommandPaletteHotkey } from "./command-palette-hotkey";

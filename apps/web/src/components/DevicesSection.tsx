import type { Device } from "@cadre/contracts";
import { Button, Input, NativeSelect, NativeSelectOption } from "@cadre/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useId, useState } from "react";
import { rpc } from "../lib/rpc";

function useDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setDevices(await rpc.devices.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { devices, error, refresh };
}

function OnlineLabel({ online }: { online: boolean }) {
  return online ? <Trans>online</Trans> : <Trans>offline</Trans>;
}

/** Account settings: the Macs and Linux machines that can be a bot's computer. */
export function DevicesSection() {
  const { t } = useLingui();
  const { devices, error, refresh } = useDevices();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      setEditing(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t`Couldn't save`);
    }
  }

  return (
    <div data-testid="devices-settings">
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Devices</Trans>
      </h3>
      {devices && devices.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          <Trans>
            Get Burst for Mac, or run burst-device on Linux, and sign in with this account. Bots
            then use that machine as their computer.
          </Trans>
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {(devices ?? []).map((device) => (
          <li
            key={device.id}
            data-testid="device-row"
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            {editing?.id === device.id ? (
              <Input
                aria-label={t`Device name`}
                value={editing.name}
                onChange={(event) => setEditing({ id: device.id, name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && editing.name.trim())
                    void run(() =>
                      rpc.devices.rename({ deviceId: device.id, name: editing.name.trim() }),
                    );
                }}
              />
            ) : (
              <span className="min-w-0 truncate text-[14px] text-foreground">
                {device.name}
                <span className="text-muted-foreground">
                  {" · "}
                  <OnlineLabel online={device.online} />
                </span>
              </span>
            )}
            <span className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  editing?.id === device.id
                    ? void run(() =>
                        rpc.devices.rename({ deviceId: device.id, name: editing.name.trim() }),
                      )
                    : setEditing({ id: device.id, name: device.name })
                }
              >
                {editing?.id === device.id ? <Trans>Save</Trans> : <Trans>Rename</Trans>}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t`Remove ${device.name}`}
                onClick={() => void run(() => rpc.devices.remove({ deviceId: device.id }))}
              >
                <Trans>Remove</Trans>
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {error || actionError ? (
        <p className="mt-2 text-[13px] text-destructive">{actionError ?? error}</p>
      ) : null}
    </div>
  );
}

/** Bot settings: choose which device is this bot's computer. */
export function DevicePicker({
  botId,
  deviceId,
  hasCloudComputer,
  onChange,
}: {
  botId: string;
  deviceId: string | null;
  hasCloudComputer: boolean;
  onChange?: (deviceId: string | null) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const { devices } = useDevices();
  const [value, setValue] = useState(deviceId ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!devices || (devices.length === 0 && !deviceId)) return null;

  async function choose(next: string) {
    const previous = value;
    setValue(next);
    setError(null);
    try {
      await rpc.devices.assign({ botId, deviceId: next || null });
      onChange?.(next || null);
    } catch (err) {
      setValue(previous);
      setError(err instanceof Error ? err.message : t`Could not save`);
    }
  }

  return (
    <label htmlFor={id} className="mt-4 block text-[14px] text-muted-foreground">
      <Trans>Device</Trans>
      <NativeSelect
        id={id}
        data-testid="bot-device-picker"
        className="mt-2 w-full"
        value={value}
        onChange={(event) => void choose(event.target.value)}
      >
        {hasCloudComputer || !value ? (
          <NativeSelectOption value="">
            {hasCloudComputer ? t`Cloud computer` : t`No device`}
          </NativeSelectOption>
        ) : null}
        {devices.map((device) => (
          <NativeSelectOption key={device.id} value={device.id}>
            {device.name} · {device.online ? t`online` : t`offline`}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {error ? <span className="mt-1 block text-[13px] text-destructive">{error}</span> : null}
    </label>
  );
}

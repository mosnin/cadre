import { useLingui } from "@lingui/react/macro";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import { useState } from "react";
import {
  WorkspaceLibraryPanel,
  type WorkspaceLibraryStatus,
} from "../components/WorkspaceLibraryPanel";

export function WorkspaceLibrary({
  onClose,
  onChange,
}: {
  onClose: () => void;
  onChange: () => void;
}) {
  const { t } = useLingui();
  const [status, setStatus] = useState<WorkspaceLibraryStatus>({ title: null, busy: false });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !status.busy) onClose();
      }}
    >
      <DialogContent className="max-w-2xl" showCloseButton={!status.busy}>
        <DialogHeader>
          <DialogTitle>{status.title ?? t`Workspace library`}</DialogTitle>
        </DialogHeader>
        <WorkspaceLibraryPanel onChange={onChange} onStatus={setStatus} />
      </DialogContent>
    </Dialog>
  );
}

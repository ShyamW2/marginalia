import type { MouseEvent, ReactNode, RefObject } from "react";
import { BrainIcon, PublishIcon, ScanIcon } from "../controls/icons.js";
import { IconButton } from "../controls/IconButton.js";
import { ProviderPickerPopover } from "../settings/ProviderPickerPopover.js";
import { KeyCapAnchor } from "../shortcuts/KeyCap.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import styles from "./ReaderActionsCluster.module.css";

interface ReaderActionsClusterProps {
  onOpenDigest: (event: MouseEvent<HTMLElement>) => void;
  onOpenScan: (event: MouseEvent<HTMLElement>) => void;
  onNavigateToSettings: (event: MouseEvent<HTMLButtonElement>) => void;
  onPublish: () => void;
  publishing: boolean;
  scanButtonRef: RefObject<HTMLButtonElement>;
  digestButtonRef: RefObject<HTMLButtonElement>;
}

/** Icon-only at rest; hovering or focusing the icon reveals its label,
 * sliding out to the left — the same anchor/hover/focus-within mechanic as
 * `shortcuts/KeyCap.module.css`, applied to a plain text label instead of a
 * keycap. */
function ActionAnchor({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.actionAnchor}>
      {children}
      <span className={styles.actionLabel} aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

/**
 * M22.5 (decisions.md 2026-08-04 "the reader's action cluster never
 * overlaps the card"): Digest, the digest provider picker, Scan and Publish
 * — formerly fixed inside `ReaderPage`'s title bar, where they collided
 * with the nav cluster at 1280px and narrower. Just the row of controls;
 * where it's mounted (beside the card, below it, or in the fullscreen
 * proximity-revealed set) is `ReaderView`'s call, the same division of
 * labour as `MarginRail`.
 */
export function ReaderActionsCluster({
  onOpenDigest,
  onOpenScan,
  onNavigateToSettings,
  onPublish,
  publishing,
  scanButtonRef,
  digestButtonRef,
}: ReaderActionsClusterProps) {
  return (
    <div className={styles.row}>
      <ActionAnchor label="Digest">
        <KeyCapAnchor shortcutKey={SHORTCUT_KEYS.digest}>
          <IconButton ref={digestButtonRef} icon={<BrainIcon size={16} />} label="Digest" onClick={onOpenDigest} />
        </KeyCapAnchor>
      </ActionAnchor>
      <ProviderPickerPopover role="digest" label="Digest provider" onNavigateToSettings={onNavigateToSettings} />
      <ActionAnchor label="Scan">
        <KeyCapAnchor shortcutKey={SHORTCUT_KEYS.scan}>
          <IconButton ref={scanButtonRef} icon={<ScanIcon size={16} />} label="Scan" onClick={onOpenScan} />
        </KeyCapAnchor>
      </ActionAnchor>
      <ActionAnchor label={publishing ? "Publishing…" : "Publish"}>
        <IconButton
          icon={<PublishIcon size={16} />}
          label={publishing ? "Publishing…" : "Publish"}
          onClick={onPublish}
          disabled={publishing}
        />
      </ActionAnchor>
    </div>
  );
}

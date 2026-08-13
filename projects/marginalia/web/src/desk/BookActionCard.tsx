import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ResourceSummary } from "@marginalia/shared";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { IconButton } from "../controls/IconButton.js";
import { BrainIcon, MagnifierIcon, PlayIcon, PublishIcon } from "../controls/icons.js";
import styles from "./BookActionCard.module.css";

/** M22.6 §D: how close the card is allowed to sit to the viewport edge before
 * it gets nudged back in. */
const EDGE_MARGIN = 8;

function relativeLastRead(iso: string | null): string {
  if (!iso) return "never opened";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "read today";
  if (days === 1) return "read yesterday";
  if (days < 30) return `read ${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `read ${months}mo ago`;
  return `read ${Math.floor(months / 12)}y ago`;
}

interface BookActionCardProps {
  resource: ResourceSummary;
  publishing: boolean;
  onPublish: (resourceId: string) => void;
  /** Which side of the book it hangs from. The Desk looks *down* at a cover
   * and hangs it below; the shelf looks at an upright spine and floats it
   * over the book's head. */
  placement?: "below" | "above";
  /** What the reader's opening transition should fly from when "Listen" opens
   * the book — the *book*, not this card's button, so listening opens exactly
   * as clicking the book does. Scan and Digest deliberately fly from their own
   * buttons instead: they are popups put *on* this surface, not a room change.
   * Falls back to the button if the surface doesn't offer one. */
  openOriginRef?: RefObject<HTMLElement | null>;
}

/**
 * A book's identity and its four actions, floating beside the book itself —
 * M22.6 §D's reworked card, extracted from `BookObject.tsx` at M23 §D so the
 * Desk and the shelf show the *same* card rather than two that drift apart.
 * Settled decision 12 ("one control system"): a control means the same thing on
 * every surface, and this is a control, not a per-room decoration.
 *
 * It positions itself against whichever ancestor establishes the containing
 * block — on the Desk that is the draggable book, on the shelf the book's slot
 * — and owns its own navigation, so a surface only has to say *which* book and
 * *where*.
 */
export function BookActionCard({
  resource,
  publishing,
  onPublish,
  placement = "below",
  openOriginRef,
}: BookActionCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  const [edgeShift, setEdgeShift] = useState(0);

  // The card is centred on the book (left: 50%, translateX(-50%)), which
  // pushes it off-screen for a book near either edge of the desk or of the
  // shelf — nothing clamps a drag position or a scroll offset. Measured after
  // it mounts, since centring depends on its own rendered width.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.right > window.innerWidth - EDGE_MARGIN) {
      setEdgeShift(window.innerWidth - EDGE_MARGIN - rect.right);
    } else if (rect.left < EDGE_MARGIN) {
      setEdgeShift(EDGE_MARGIN - rect.left);
    } else {
      setEdgeShift(0);
    }
    // Re-measured per book: the card is remounted (or re-keyed) as the active
    // book changes, and a wider title moves the clamp.
  }, [resource.id]);

  // M20.5 "the Scan becomes a popup": flies in from the button that opened it
  // (the same `background`-location pattern Settings already uses), not the
  // old Book<->Scan airlock — there's no longer a room to travel to
  // (decisions.md 2026-07-30). Deliberately *not* gated on `openedRef`: these
  // overlays leave the surface underneath mounted, so a permanent latch would
  // block re-opening either one after the first click.
  function openScan(event: MouseEvent<HTMLElement>) {
    setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
    navigate(`/scan/${resource.id}`, { state: { background: location } });
  }

  function openDigest(event: MouseEvent<HTMLElement>) {
    setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
    navigate(`/digest/${resource.id}`, { state: { background: location } });
  }

  // M21 "Listen" (AUDIO.md: "the tool is the charm, not the gate" — this plain
  // action is the canonical path). Opens the reader *room*, unlike Scan and
  // Digest, so it does take the one-shot guard.
  function openListen(event: MouseEvent<HTMLElement>) {
    if (openedRef.current) return;
    openedRef.current = true;
    setPendingOverlayOrigin(captureOverlayOrigin(openOriginRef?.current ?? event.currentTarget));
    navigate(`/read/${resource.id}`, { state: { listenOnOpen: true } });
  }

  return (
    <div
      ref={cardRef}
      className={`${styles.card} ${placement === "above" ? styles.above : styles.below}`}
      role="note"
      style={edgeShift ? { transform: `translateX(calc(-50% + ${edgeShift}px))` } : undefined}
    >
      <div className={styles.title}>{resource.title}</div>
      <div className={styles.meta}>
        {resource.author && <span>{resource.author}</span>}
        <span>{relativeLastRead(resource.lastReadAt)}</span>
        <span>
          {resource.threadCount} thread{resource.threadCount === 1 ? "" : "s"}
        </span>
        <span>
          {resource.highlightCount} highlight{resource.highlightCount === 1 ? "" : "s"}
        </span>
      </div>
      {/* The same control system as the reader's own action row
          (ReaderActionsCluster) — IconButton plus the same icon components — so
          a control means the same thing on both surfaces (settled decision 12).
          `stopPropagation` stays on every one: without it the card's own click
          also opens the book (the Desk's `onTap`, the shelf's slot click),
          caught live on the Desk. */}
      <div className={styles.actions}>
        <IconButton
          variant="ghost"
          size="sm"
          icon={<BrainIcon size={16} />}
          label="Read digest"
          onClick={(e) => {
            e.stopPropagation();
            openDigest(e);
          }}
        />
        <IconButton
          variant="ghost"
          size="sm"
          icon={<MagnifierIcon size={16} />}
          label="Open scan"
          onClick={(e) => {
            e.stopPropagation();
            openScan(e);
          }}
        />
        <IconButton
          variant="ghost"
          size="sm"
          icon={<PlayIcon size={16} />}
          label="Listen"
          onClick={(e) => {
            e.stopPropagation();
            openListen(e);
          }}
        />
        <IconButton
          variant="ghost"
          size="sm"
          icon={<PublishIcon size={16} />}
          label={publishing ? "Publishing…" : "Publish"}
          disabled={publishing}
          onClick={(e) => {
            e.stopPropagation();
            onPublish(resource.id);
          }}
        />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type RefObject } from "react";
import { motion, useDragControls, useMotionValue, useReducedMotion } from "motion/react";
import type { Definition, ProviderRole } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { useProviderRoles } from "../settings/useProviderRoles.js";
import { streamDefine } from "./streamDefine.js";
import styles from "./DefinitionCard.module.css";

export interface DefinitionCardState {
  left: number;
  top: number;
  /** The word as the reader selected it — shown while the lookup is still
   * running, before there's a resolved headword to show instead. */
  term: string;
  /** The highlight Define marked; null only in the instant before the
   * highlight POST resolves. */
  highlightId: string | null;
  /** null while the lookup is in flight. */
  result: Definition | null;
}

interface DefinitionCardProps {
  state: DefinitionCardState;
  onClose: () => void;
  /** M30 C: "It does not open the thread panel unless the reader asks" —
   * this is the asking. Escalates the same sage highlight into a real
   * conversation rather than starting a second one. */
  onAsk: () => void;
  /** M30 E feedback: the reader chose to look deeper and the stream
   * finished — mirrors the answer into `highlights` state (glossary, scan)
   * exactly like the dictionary path already does, since this card doesn't
   * own that state itself. */
  onDeepened: (highlightId: string, definition: Definition) => void;
  /** M30 E feedback "1a": draggable, same roam bounds as ThreadPanel. */
  appBoundsRef: RefObject<HTMLDivElement>;
}

const ROLE_LABEL: Record<ProviderRole, string> = { query: "Query", digest: "Digest" };

/** The three empty states say different things because they ask the reader
 * for different things: one is "you haven't connected a provider", one is
 * "this word isn't a word", one is "neither path found it". Collapsing them
 * would send a reader to Settings for a word that simply isn't a word. */
function emptyMessage(reason: Definition["reason"]): string {
  switch (reason) {
    case "no_provider":
      return "No definition found. The dictionary doesn't have this one, and no LLM provider is connected to fall back to.";
    case "not_a_term":
      return "That's too long to define. Select a word or a short phrase.";
    case "not_found":
      return "No definition found — neither the dictionary nor this book's digest could place it.";
    default:
      return "";
  }
}

/**
 * M30 C: where a Define lands. Deliberately *not* the thread panel — this is
 * a lookup, and a lookup that opened a conversation surface would make the
 * reader close a conversation they never started. It shows one answer, says
 * where the answer came from, and offers the one escalation ("Ask about
 * this") that turns it into the thread it declined to be.
 *
 * Every state here is designed, per M30 C's "no spinner and never a crash":
 * a lookup in flight, a dictionary hit, a digest hit, each of the designed
 * ways of finding nothing, and — M30 E feedback — a dictionary miss with a
 * provider configured, which now *asks* before spending 100+ seconds on a
 * reasoning model instead of spending it automatically.
 */
export function DefinitionCard({ state, onClose, onAsk, onDeepened, appBoundsRef }: DefinitionCardProps) {
  const reducedMotion = useReducedMotion();
  const { result } = state;
  const found = result !== null && result.definition.length > 0;
  // The dictionary's headword can differ from what was selected once
  // morphology has run ("running" -> "run"); showing the selection instead
  // would quietly define a different word than the one on screen.
  const heading = found ? result.headword || state.term : state.term;

  // M30 E feedback "1a": draggable by the header only, same mechanics as
  // ThreadPanel (dragControls.start from the header's own pointerdown,
  // dragConstraints={appBoundsRef} so it can't be dragged out of the room).
  // Deliberately not persisted: unlike the thread panel, a fresh Define
  // always re-anchors at the new selection, so remembering a stale offset
  // from a previous, unrelated word would be the wrong default.
  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);

  function handleHeaderPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    dragControls.start(event);
  }

  // M30 E feedback "1b": the reader's own "look deeper" — narrated progress
  // (never a fabricated chain-of-thought; see dictionary/define.ts) plus the
  // answer composing live. Local and transient: once the stream's `done`
  // event lands, `onDeepened` updates `state.result` from above and this
  // resets to null, letting the normal found/empty render branches take over.
  const [deepenRole, setDeepenRole] = useState<ProviderRole>("query");
  const [deepen, setDeepen] = useState<{ steps: string[]; liveText: string } | null>(null);
  const { roles, loading: rolesLoading } = useProviderRoles();
  const deepenAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => deepenAbortRef.current?.abort();
  }, []);

  function handleDeepen() {
    if (!state.highlightId) return;
    const highlightId = state.highlightId;
    setDeepen({ steps: [], liveText: "" });
    const controller = new AbortController();
    deepenAbortRef.current = controller;
    void streamDefine(
      `/api/highlights/${highlightId}/definition/deepen`,
      { role: deepenRole },
      {
        onStep: (step) => setDeepen((prev) => (prev ? { ...prev, steps: [...prev.steps, step] } : prev)),
        onText: (text) =>
          setDeepen((prev) => (prev ? { ...prev, liveText: prev.liveText + text } : prev)),
        onDone: (definition) => {
          onDeepened(highlightId, definition);
          setDeepen(null);
        },
        onError: () => {
          onDeepened(highlightId, {
            headword: state.term,
            definition: "",
            source: "",
            attribution: "",
            reason: "not_found",
          });
          setDeepen(null);
        },
      },
      controller.signal,
    );
  }

  const configuredRoles = roles.filter((r) => r.configured);

  return (
    <div className={styles.cardPosition} style={{ left: state.left, top: state.top }}>
      <motion.div
        className={styles.card}
        style={{ x: dragX, y: dragY }}
        role="dialog"
        aria-label={`Definition of ${heading}`}
        drag
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={appBoundsRef}
        dragElastic={0}
        dragMomentum={false}
        // M30 E feedback "1a": `y` (and `x`) are owned by dragX/dragY above
        // now — ThreadPanel's own drag+mount-animation combination is why
        // *that* one animates scaleY/rotateX rather than y, and the same
        // rule applies here: animating `y` via initial/animate while it's
        // also bound to an external motion value in `style` fights itself.
        initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.94 }}
        transition={
          reducedMotion
            ? { duration: 0.12 }
            : { type: "spring", stiffness: 460, damping: 32 }
        }
      >
        <div className={styles.header} onPointerDown={handleHeaderPointerDown}>
          <span className={styles.headword}>{heading}</span>
          <IconButton icon="×" label="Close" size="sm" className={styles.close} onClick={onClose} />
        </div>

        {result === null ? (
          // Not a spinner over the text (CLAUDE.md: "reading comes first").
          // A dictionary hit resolves in single-digit milliseconds, so this
          // is only ever seen on the digest-rung fallback.
          <p className={styles.looking}>Looking up…</p>
        ) : found ? (
          <>
            <p className={styles.definition}>{result.definition}</p>
            <div className={styles.footer}>
              <span className={styles.attribution}>
                {result.source === "dictionary"
                  ? result.attribution
                  : `From the digest of ${result.attribution}`}
              </span>
              <Button variant="ghost" size="sm" onClick={onAsk} className={styles.askMore}>
                Ask about this
              </Button>
            </div>
          </>
        ) : result.reason === "dictionary_miss" ? (
          deepen ? (
            <>
              <ul className={styles.thoughts}>
                {deepen.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
              {deepen.liveText && <p className={styles.definition}>{deepen.liveText}</p>}
            </>
          ) : (
            <>
              <p className={styles.empty}>
                Not in the dictionary — this may be a word the book coins, or one WordNet doesn't have.
              </p>
              <div className={styles.deepenRow}>
                <select
                  aria-label="Model for the deeper search"
                  className={styles.roleSelect}
                  value={deepenRole}
                  onChange={(event) => setDeepenRole(event.target.value as ProviderRole)}
                  disabled={rolesLoading || configuredRoles.length === 0}
                >
                  {roles.map((r) => (
                    <option key={r.role} value={r.role} disabled={!r.configured}>
                      {ROLE_LABEL[r.role]} — {r.profile?.name ?? "not configured"}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeepen}
                  disabled={rolesLoading || configuredRoles.length === 0}
                  className={styles.deepenButton}
                >
                  Look deeper
                </Button>
              </div>
              <div className={styles.footer}>
                <span className={styles.attribution} />
                <Button variant="ghost" size="sm" onClick={onAsk} className={styles.askMore}>
                  Ask about this
                </Button>
              </div>
            </>
          )
        ) : (
          <>
            <p className={styles.empty}>{emptyMessage(result.reason)}</p>
            {result.reason !== "not_a_term" && (
              <div className={styles.footer}>
                <span className={styles.attribution} />
                <Button variant="ghost" size="sm" onClick={onAsk} className={styles.askMore}>
                  Ask about this
                </Button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

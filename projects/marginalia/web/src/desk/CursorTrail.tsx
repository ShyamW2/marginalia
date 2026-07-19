import { useEffect, useRef, type RefObject } from "react";
import styles from "./CursorTrail.module.css";

const MAX_PARTICLES = 60;
const PARTICLES_PER_MOVE = 2;
const IDLE_MS = 400;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

function hexToRgbTriplet(hex: string): string {
  const clean = hex.trim().replace("#", "");
  if (clean.length !== 6) return "138, 90, 59";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

interface CursorTrailProps {
  containerRef: RefObject<HTMLElement>;
  enabled: boolean;
}

/**
 * The desk's ink-droplet cursor trail (DESIGN.md "Cursor system"): a canvas
 * overlay, decaying particles, idles when the cursor rests. `pointer-events:
 * none` so it never intercepts drag/click on the books beneath it.
 */
export function CursorTrail({ containerRef, enabled }: CursorTrailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let raf = 0;
    let running = false;
    let lastMoveAt = performance.now();
    let colorTriplet = hexToRgbTriplet(
      getComputedStyle(container).getPropertyValue("--color-accent") || "#8a5a3b",
    );

    function resize() {
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    function tick() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter((p) => p.life > 0.03);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.life *= 0.94;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${colorTriplet}, ${p.life * 0.45})`;
        ctx.arc(p.x, p.y, 2.5 * p.life + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const idle = performance.now() - lastMoveAt > IDLE_MS;
      if (particles.length === 0 && idle) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    function onMove(event: PointerEvent) {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      lastMoveAt = performance.now();
      colorTriplet = hexToRgbTriplet(
        getComputedStyle(container).getPropertyValue("--color-accent") || "#8a5a3b",
      );
      for (let i = 0; i < PARTICLES_PER_MOVE && particles.length < MAX_PARTICLES; i++) {
        particles.push({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5 - 0.15,
          life: 1,
        });
      }
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    }

    container.addEventListener("pointermove", onMove);
    return () => {
      container.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, [enabled, containerRef]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}

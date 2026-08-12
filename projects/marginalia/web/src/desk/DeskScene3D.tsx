import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils, MeshStandardMaterial, Vector3, type Group, type Mesh, type OrthographicCamera } from "three";
import type { MotionValue } from "motion/react";
import { Book3D } from "../scene3d/Book3D.js";
import { bookTilt, stackElevation } from "./deskDepthMath.js";
import { useDeskThemeColors } from "./useDeskThemeColors.js";

// BookObject.module.css/DeskCanvas.tsx's own footprint: 168px cover, 2:3.
const BOOK_WIDTH = 168;
const BOOK_HEIGHT = 252;
const BOOK_THICKNESS = 16;
const MAX_TILT = MathUtils.degToRad(24);
// World units (== css px, DeskCameraRig's whole point) from the viewport's
// centre at which a book reaches full tilt.
const TILT_FALLOFF = 460;
const STACK_STEP = 0.6;
const CAMERA_HEIGHT = 1200;
const UP = new Vector3(0, 1, 0);

export interface DeskBookPlacement {
  resourceId: string;
  rotationDeg: number;
  zOrder: number;
  x: MotionValue<number>;
  y: MotionValue<number>;
}

interface Origin {
  x: number;
  z: number;
}

/**
 * M23 §B: the desk's 3D depth layer, registered into the one shared canvas
 * (`scene3d/Scene3D.tsx`) by `DeskCanvas.tsx`. Renders the same `Book3D`
 * asset §A built, laid flat and tilted to reveal thickness as each book
 * moves off the viewport's centre — see `deskDepthMath.ts` for why an
 * orthographic camera and a faked tilt, rather than a real perspective
 * camera, is what keeps this aligned with the DOM `BookObject`s that still
 * own drag/drop and hit-testing. This component only ever *reads* book
 * position (via the live `x`/`y` motion values `DeskCanvas.tsx` now owns) —
 * it never writes back to the desk's layout state.
 */
export function DeskScene3D({ books, deskRef }: { books: DeskBookPlacement[]; deskRef: RefObject<HTMLElement> }) {
  const originRef = useRef<Origin>({ x: 0, z: 0 });
  const pivotRef = useRef<Origin>({ x: 0, z: 0 });
  const { size } = useThree();

  useFrame(() => {
    const rect = deskRef.current?.getBoundingClientRect();
    if (rect) {
      originRef.current.x = rect.left;
      originRef.current.z = rect.top;
    }
    pivotRef.current.x = size.width / 2;
    pivotRef.current.z = size.height / 2;
  });

  const zOrders = useMemo(() => books.map((b) => b.zOrder), [books]);

  return (
    <>
      <DeskCameraRig />
      <DeskSurface deskRef={deskRef} originRef={originRef} />
      {books.map((book) => (
        <DeskBook3D
          key={book.resourceId}
          book={book}
          originRef={originRef}
          pivotRef={pivotRef}
          elevation={0.3 + stackElevation(book.zOrder, zOrders, STACK_STEP)}
        />
      ))}
    </>
  );
}

/**
 * A straight-down orthographic camera whose frustum is fitted to the
 * viewport every frame, with world X/Z mapped 1:1 to viewport-pixel X/Y —
 * so a book's stored desk-local (x, y) plus the desk container's own
 * on-screen offset (`originRef`) is exactly where it renders, no reprojection
 * required for `BookObject.tsx`'s DOM hit target to agree with it.
 */
function DeskCameraRig() {
  const cameraRef = useRef<OrthographicCamera>(null!);
  const { size, set, camera: previousCamera } = useThree();

  useEffect(() => {
    const camera = cameraRef.current;
    // R3F's own resize handling overwrites left/right/top/bottom with a
    // frustum centred on world (0,0) on every size change unless told this
    // camera is manually managed (`updateCamera` in R3F's source) — without
    // this flag it was silently stomping the offset frustum below, and
    // R3F's *default* perspective camera (never removed from the scene,
    // just no longer the active one) was what actually rendered instead,
    // caught live as a keystoned/trapezoidal book shape that had nothing to
    // do with the tilt math.
    // Untyped in three.js's own Camera — R3F's own convention (see the
    // `updateCamera` comment this is working around), not exposed as a
    // public property.
    (camera as OrthographicCamera & { manual?: boolean }).manual = true;
    camera.up.set(0, 0, -1);
    camera.position.set(0, CAMERA_HEIGHT, 0);
    camera.lookAt(0, 0, 0);
    set({ camera });
    return () => set({ camera: previousCamera });
    // Runs once: `set`/`previousCamera` come from the R3F store and aren't
    // meant to re-trigger this — the frustum itself is refitted every frame
    // below, independent of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const camera = cameraRef.current;
    camera.left = 0;
    camera.right = size.width;
    camera.top = 0;
    camera.bottom = -size.height;
    camera.near = 1;
    camera.far = CAMERA_HEIGHT * 2;
    camera.updateProjectionMatrix();
  });

  return <orthographicCamera ref={cameraRef} />;
}

/**
 * The desk's own surface plane and a thin raised edge — TASKS.md M23 §B's
 * "a desk that looks like a desk". Sized and positioned from the same
 * container rect every frame as the books above it, so it always exactly
 * covers the desk's real (possibly taller-than-viewport, scrollable) extent
 * rather than just whatever's currently on screen.
 */
function DeskSurface({ deskRef, originRef }: { deskRef: RefObject<HTMLElement>; originRef: MutableRefObject<Origin> }) {
  const planeRef = useRef<Mesh>(null!);
  const edgeRefs = useRef<(Mesh | null)[]>([null, null, null, null]);
  const colors = useDeskThemeColors();

  const surfaceMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), []);
  const edgeMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.7, metalness: 0 }), []);
  useEffect(() => {
    surfaceMaterial.color.set(colors.bg || "#111111");
    edgeMaterial.color.set(colors.accent || "#333333");
  }, [colors, surfaceMaterial, edgeMaterial]);
  useEffect(() => {
    return () => {
      surfaceMaterial.dispose();
      edgeMaterial.dispose();
    };
  }, [surfaceMaterial, edgeMaterial]);

  useFrame(() => {
    const rect = deskRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const width = rect.width;
    const height = rect.height;
    const centerX = originRef.current.x + width / 2;
    const centerZ = originRef.current.z + height / 2;

    const plane = planeRef.current;
    plane.scale.set(width, height, 1);
    plane.position.set(centerX, -0.6, centerZ);

    // Four thin raised boxes framing the plane's perimeter — top, bottom,
    // left, right, in that order — a shallow lip rather than a hard bevel.
    const rim = 6;
    const [top, bottom, left, right] = edgeRefs.current;
    top?.scale.set(width + rim * 2, 1.6, rim);
    top?.position.set(centerX, 0.2, originRef.current.z - rim / 2);
    bottom?.scale.set(width + rim * 2, 1.6, rim);
    bottom?.position.set(centerX, 0.2, originRef.current.z + height + rim / 2);
    left?.scale.set(rim, 1.6, height);
    left?.position.set(originRef.current.x - rim / 2, 0.2, centerZ);
    right?.scale.set(rim, 1.6, height);
    right?.position.set(originRef.current.x + width + rim / 2, 0.2, centerZ);
  });

  return (
    <>
      <mesh ref={planeRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1, 1]} />
        <primitive object={surfaceMaterial} attach="material" />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            edgeRefs.current[i] = el;
          }}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={edgeMaterial} attach="material" />
        </mesh>
      ))}
    </>
  );
}

/**
 * One book, followed live off the DOM `BookObject`'s own motion values so
 * it moves in step with an in-progress drag rather than jumping once the
 * drag commits (TASKS.md: "smoothly animated, not stepped"). The group's
 * own origin sits at the book's visual centre (Book3D's spine is at local
 * x=0, an edge — re-centred here via the inner offset group) so a yaw
 * rotation pivots the same way the DOM cover's CSS `rotate()` already does.
 */
function DeskBook3D({
  book,
  originRef,
  pivotRef,
  elevation,
}: {
  book: DeskBookPlacement;
  originRef: MutableRefObject<Origin>;
  pivotRef: MutableRefObject<Origin>;
  elevation: number;
}) {
  const groupRef = useRef<Group>(null!);
  const tiltAxis = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const group = groupRef.current;
    const worldX = originRef.current.x + book.x.get() + BOOK_WIDTH / 2;
    const worldZ = originRef.current.z + book.y.get() + BOOK_HEIGHT / 2;

    group.position.set(worldX, elevation, worldZ);
    group.quaternion.identity();
    group.rotateX(-Math.PI / 2);
    group.rotateOnWorldAxis(UP, MathUtils.degToRad(book.rotationDeg));

    const { axis, angle } = bookTilt(worldX, worldZ, pivotRef.current.x, pivotRef.current.z, MAX_TILT, TILT_FALLOFF);
    if (angle > 0) {
      tiltAxis.set(axis[0], axis[1], axis[2]);
      group.rotateOnWorldAxis(tiltAxis, angle);
    }
  });

  return (
    <group ref={groupRef}>
      <group position={[-BOOK_WIDTH / 2, 0, 0]}>
        <Book3D resourceId={book.resourceId} width={BOOK_WIDTH} height={BOOK_HEIGHT} thickness={BOOK_THICKNESS} />
      </group>
    </group>
  );
}

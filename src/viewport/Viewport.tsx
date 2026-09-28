/**
 * Viewport 3D principal.
 *
 * `frameloop="demand"` : une image n'est calculée que lorsque quelque chose
 * change (caméra, objet, gizmo). Au repos, le GPU ne travaille pas — important
 * pour l'autonomie d'un MacBook.
 */
import { memo, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei';
import { PMREMGenerator, type Mesh, type PerspectiveCamera } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { select, setLookThrough, useEditor } from '../store/editorStore.ts';
import { DEFAULT_VIEW, attachCameraBridge, type OrbitLike } from './cameraController.ts';
import { shouldIgnoreClick } from './interactionGuard.ts';
import { ObjectNode } from './objects/ObjectNode.tsx';
import { TransformGizmo } from './TransformGizmo.tsx';

/** Liste des objets racine. Ne se re-rend que si des objets racine sont ajoutés/supprimés/réordonnés. */
const SceneObjects = memo(function SceneObjects() {
  const rootIds = useEditor((s) => s.doc.rootIds);
  const epoch = useEditor((s) => s.docEpoch);
  return (
    <>
      {rootIds.map((id) => (
        <ObjectNode key={`${epoch}:${id}`} id={id} />
      ))}
    </>
  );
});

/** Fond, lumière ambiante et « soleil » définis par les réglages de la scène. */
function SceneEnvironment() {
  const background = useEditor((s) => s.doc.settings.background);
  const ambient = useEditor((s) => s.doc.settings.ambientIntensity);
  const sun = useEditor((s) => s.doc.settings.sunIntensity);
  const shadows = useEditor((s) => s.doc.settings.shadows);
  return (
    <>
      <color attach="background" args={[background]} />
      <ambientLight intensity={ambient} />
      <directionalLight
        position={[12, 20, 8]}
        intensity={sun}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={80}
      />
      <NeutralEnvironment />
      {shadows && <ShadowCatcher />}
    </>
  );
}

/**
 * Éclairage d'environnement neutre, généré localement (aucun fichier HDR à télécharger) :
 * indispensable pour que les matériaux PBR des modèles (métal, verre, vernis) aient des reflets.
 */
function NeutralEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const intensity = useEditor((s) => s.doc.settings.environmentIntensity);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      room.traverse((o) => (o as Mesh).geometry?.dispose());
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
    invalidate();
  }, [scene, intensity, invalidate]);
  return null;
}

const noRaycast = () => null;

/** Sol invisible qui ne fait que recevoir les ombres (la grille reste visible au-dessus). */
function ShadowCatcher() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow raycast={noRaycast}>
      <planeGeometry args={[400, 400]} />
      <shadowMaterial opacity={0.3} />
    </mesh>
  );
}

function EditorGrid() {
  const visible = useEditor((s) => s.doc.settings.gridVisible);
  if (!visible) return null;
  return (
    <Grid
      infiniteGrid
      cellSize={0.5}
      cellThickness={0.6}
      cellColor="#3a3f4a"
      sectionSize={5}
      sectionThickness={1.1}
      sectionColor="#5a6272"
      fadeDistance={80}
      fadeStrength={1.5}
      position={[0, -0.001, 0]}
    />
  );
}

/** Expose la caméra et les OrbitControls au cameraController (actions hors Canvas). */
function CameraBridge() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const domElement = useThree((s) => s.gl.domElement);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (!controls) return;
    attachCameraBridge({ camera, controls, invalidate, domElement, scene });
    // Dès que l'utilisateur manipule la vue, on ne regarde plus « à travers » une caméra de scène.
    const leaveLookThrough = () => setLookThrough(null);
    controls.addEventListener('start', leaveLookThrough);
    return () => {
      controls.removeEventListener('start', leaveLookThrough);
      attachCameraBridge(null);
    };
  }, [camera, controls, invalidate, domElement, scene]);
  return null;
}

// Constantes de module : le Viewport ne doit jamais ré-appliquer ces valeurs après le montage.
const INITIAL_CAMERA = { position: DEFAULT_VIEW.position.toArray(), fov: DEFAULT_VIEW.fov, near: 0.05, far: 2000 };
const INITIAL_TARGET = DEFAULT_VIEW.target.toArray();

export function Viewport() {
  return (
    <Canvas
      className="viewport-canvas"
      frameloop="demand"
      dpr={[1, 2]}
      shadows
      camera={INITIAL_CAMERA}
      onPointerMissed={(e) => {
        // Clic dans le vide = désélection. R3F ignore déjà les gestes d'orbit (déplacement > 2 px) ;
        // on ignore en plus le clic qui suit une manipulation du gizmo.
        if (e.button !== 0 || shouldIgnoreClick()) return;
        select(null);
      }}
    >
      <SceneEnvironment />
      <EditorGrid />
      <SceneObjects />
      <TransformGizmo />
      <OrbitControls
        makeDefault
        target={INITIAL_TARGET}
        enableDamping
        dampingFactor={0.12}
        minDistance={0.2}
        maxDistance={800}
      />
      <CameraBridge />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#e5534b', '#57ab5a', '#539bf5']} labelColor="#111" />
      </GizmoHelper>
    </Canvas>
  );
}


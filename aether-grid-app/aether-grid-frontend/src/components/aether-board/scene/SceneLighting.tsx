export function SceneLighting() {
  return (
    <>
      <ambientLight intensity={1.1} />
      <hemisphereLight
        color="#fff8e8"
        groundColor="#6b8a6b"
        intensity={1.15}
      />
      {/* Luz principal tipo estrella/sol */}
      <directionalLight
        position={[12, 20, 10]}
        intensity={4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={60}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-bias={-0.0002}
      />
      {/* Relleno desde el lado opuesto para que no queden caras negras */}
      <directionalLight position={[-8, 10, -6]} intensity={1.2} />
    </>
  );
}

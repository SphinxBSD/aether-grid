import { TILE_SIZE } from '../constants';
import { tileToWorld } from '../game/gameUtils';

interface TileHighlightProps {
  hoveredTile: { x: number; y: number } | null;
  drilledTiles: Set<string>;
  playerTile: { x: number; y: number } | null;
}

const topY = TILE_SIZE + 0.01;

function tileTopPos(i: number, j: number): [number, number, number] {
  const [wx, , wz] = tileToWorld(i, j);
  return [wx, topY, wz];
}

export function TileHighlight({ hoveredTile, drilledTiles, playerTile }: TileHighlightProps) {
  return (
    <group>
      {hoveredTile && (
        <mesh position={tileTopPos(hoveredTile.x, hoveredTile.y)} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[TILE_SIZE * 0.98, TILE_SIZE * 0.98]} />
          <meshBasicMaterial color="#00d4ff" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}

      {Array.from(drilledTiles).map((key) => {
        const [i, j] = key.split('-').map(Number);
        return (
          <mesh key={key} position={tileTopPos(i, j)} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[TILE_SIZE * 0.98, TILE_SIZE * 0.98]} />
            <meshBasicMaterial color="#ff9500" transparent opacity={0.6} depthWrite={false} />
          </mesh>
        );
      })}

      {playerTile && (
        <mesh position={tileTopPos(playerTile.x, playerTile.y)} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[TILE_SIZE * 0.35, TILE_SIZE * 0.5, 16]} />
          <meshBasicMaterial color="#ffaa00" transparent opacity={0.5} side={2} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

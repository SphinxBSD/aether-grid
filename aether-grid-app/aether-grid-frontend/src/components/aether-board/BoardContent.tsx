import type { MapTile } from './mapData';
import { AsteroidBase } from './AsteroidBase';
import { BoardTiles } from './boardTiles';
import { MapObjects } from './mapObjects';
import { PlayerAvatar } from './player/PlayerAvatar';
import { useAetherGameStore } from './game/gameStore';

export interface BoardContentProps {
  map: MapTile[];
}

export function BoardContent({ map }: BoardContentProps) {
  const {
    phase,
    selectSpawn,
    setTargetAndMove,
    setHoveredTile,
    hoveredTile,
    drilledTiles,
    playerTile,
  } = useAetherGameStore();

  const onTileClick = (tile: MapTile) => {
    const i = tile.position[0];
    const j = tile.position[2];
    if (phase === 'SPAWN_SELECT') selectSpawn(i, j);
    else if (phase === 'PLAYING') setTargetAndMove(i, j);
  };

  const onTileHover = (tile: MapTile | null) => {
    if (tile) setHoveredTile(tile.position[0], tile.position[2]);
    else setHoveredTile(null, null);
  };

  return (
    <group>
      <AsteroidBase />
      <BoardTiles
        map={map}
        onTileClick={onTileClick}
        onTileHover={onTileHover}
        hoveredTile={hoveredTile}
        drilledTiles={drilledTiles}
        playerTile={playerTile}
      />
      <MapObjects map={map} />
      <PlayerAvatar />
    </group>
  );
}

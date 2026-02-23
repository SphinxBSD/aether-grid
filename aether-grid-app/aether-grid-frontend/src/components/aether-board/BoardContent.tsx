import type { MapTile } from './mapData';
import { AsteroidBase } from './AsteroidBase';
import { BoardTiles } from './boardTiles';
import { MapObjects } from './mapObjects';
import { PlayerAvatar } from './player/PlayerAvatar';
import { useAetherGameStore } from './game/gameStore';
import { RadarAreaEffect, LineScanEffect, DrillEffect, DashTrail } from './effects';

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
    activePower,
    useRadar,
    radarEffect,
    scanLineEffect,
    drillEffect,
    dashTrailPositions,
  } = useAetherGameStore();

  const onTileClick = (tile: MapTile) => {
    const i = tile.position[0];
    const j = tile.position[2];
    if (phase === 'SPAWN_SELECT') {
      selectSpawn(i, j);
      return;
    }
    if (phase === 'PLAYING') {
      if (activePower === 'RADAR') {
        useRadar(i, j);
        return;
      }
      if (activePower === 'IMPULSE' || activePower === 'MOVE') {
        setTargetAndMove(i, j);
      }
    }
  };

  const onTileHover = (tile: MapTile | null) => {
    if (tile) setHoveredTile(tile.position[0], tile.position[2]);
    else setHoveredTile(null, null);
  };

  return (
    <group position={[0, 0, 0]}>
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
      <RadarAreaEffect effect={radarEffect} />
      <LineScanEffect effect={scanLineEffect} />
      <DrillEffect effect={drillEffect} />
      <DashTrail positions={dashTrailPositions} />
      <PlayerAvatar />
    </group>
  );
}

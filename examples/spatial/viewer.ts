import type { Vec3 } from 'simkind/spatial';
export interface SpatialView { world: { positions: Record<string, Vec3>; obstacles: { center: Vec3; radius: number }[] } }
/** Presentation-only projection. Viewer attachment never schedules or mutates a host. */
export function projectScene(snapshot: SpatialView, yaw = 0.6, pitch = 0.5) {
  const project = ([x, y, z]: Vec3) => {
    const horizontal = x * Math.cos(yaw) - z * Math.sin(yaw);
    const depth = x * Math.sin(yaw) + z * Math.cos(yaw);
    return { x: horizontal, y: depth * Math.sin(pitch) - y * Math.cos(pitch), depth: depth * Math.cos(pitch) + y * Math.sin(pitch) };
  };
  return { bodies: Object.entries(snapshot.world.positions).map(([id, position]) => ({ id, ...project(position) })).sort((a, b) => a.depth - b.depth),
    obstacles: snapshot.world.obstacles.map(o => ({ ...project(o.center), radius: o.radius })) };
}

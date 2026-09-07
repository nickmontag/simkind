export type Vec3 = [number, number, number];
export interface SpatialFrame {
  id: string;
  /** Origin in metres in the canonical right-handed, Y-up world frame. */
  origin: Vec3;
  /** Three local unit axes expressed in world coordinates. */
  axes: [Vec3, Vec3, Vec3];
  metresPerUnit: number;
}
export const spatialProfile = { id: 'simkind.spatial', version: '0.1.0' } as const;
export const worldFrame: SpatialFrame = { id: 'frame:world', origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], metresPerUnit: 1 };
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, n, i) => sum + n * b[i], 0);
export function validateFrame(frame: SpatialFrame): void {
  const vectors = [frame.origin, ...frame.axes];
  if (!frame.id || frame.axes.length !== 3 || vectors.some(v => v.length !== 3 || v.some(n => !Number.isFinite(n))) || !Number.isFinite(frame.metresPerUnit) || frame.metresPerUnit <= 0) throw new Error('Invalid spatial frame.');
  const [a, b, c] = frame.axes;
  const cross: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  if (frame.axes.some(v => Math.abs(dot(v, v) - 1) > 1e-9) || Math.abs(dot(a, b)) > 1e-9 || Math.abs(dot(b, c)) > 1e-9 || Math.abs(dot(a, c)) > 1e-9 || Math.abs(dot(cross, c) - 1) > 1e-9) throw new Error('Frame axes must form a right-handed orthonormal basis.');
}
function validatePoint(point: Vec3) { if (point.length !== 3 || point.some(n => !Number.isFinite(n))) throw new Error('Invalid spatial point.'); }
export function toWorld(point: Vec3, frame: SpatialFrame): Vec3 {
  validateFrame(frame); validatePoint(point);
  return frame.origin.map((origin, i) => origin + point.reduce((sum, n, axis) => sum + n * frame.axes[axis][i] * frame.metresPerUnit, 0)) as Vec3;
}
export function fromWorld(point: Vec3, frame: SpatialFrame): Vec3 {
  validateFrame(frame); validatePoint(point);
  const delta = point.map((n, i) => n - frame.origin[i]) as Vec3;
  return frame.axes.map(axis => dot(delta, axis) / frame.metresPerUnit) as Vec3;
}
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(...a.map((n, i) => n - b[i]));

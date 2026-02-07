const lastHitByPlayer = new Map<string, string>();
const pendingGetByPlayer = new Set<string>();

export function setLastHit(playerId: string, entityRuntimeId: string): void {
  lastHitByPlayer.set(playerId, entityRuntimeId);
}

export function getLastHit(playerId: string): string | undefined {
  return lastHitByPlayer.get(playerId);
}

export function addPendingGet(playerId: string): void {
  pendingGetByPlayer.add(playerId);
}

export function hasPendingGet(playerId: string): boolean {
  return pendingGetByPlayer.has(playerId);
}

export function consumePendingGet(playerId: string): boolean {
  if (!pendingGetByPlayer.has(playerId)) return false;
  pendingGetByPlayer.delete(playerId);
  return true;
}

import { world, type Entity } from "@minecraft/server";

const STORE_KEY = "fmbe:groups";
const ENTITY_GROUP_DP = "fmbe:group";
const GROUP_TAG_PREFIX = "fmbe:group:";

let loaded = false;
let groups = new Map<string, Set<string>>();

function ensureLoaded(): void {
  if (loaded) return;

  const raw = world.getDynamicProperty(STORE_KEY);
  if (typeof raw !== "string" || raw.length === 0) {
    loaded = true;
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    groups = new Map<string, Set<string>>();
    for (const [groupName, ids] of Object.entries(parsed)) {
      groups.set(groupName, new Set(ids));
    }
  } catch {
    groups = new Map<string, Set<string>>();
  }

  loaded = true;
}

function save(): void {
  const snapshot: Record<string, string[]> = {};
  for (const [groupName, ids] of groups) {
    snapshot[groupName] = [...ids.values()];
  }
  world.setDynamicProperty(STORE_KEY, JSON.stringify(snapshot));
}

function sanitizeGroupNameForTag(groupName: string): string {
  return groupName.replace(/[^a-zA-Z0-9_:\-./]/g, "_");
}

function groupTag(groupName: string): string {
  return `${GROUP_TAG_PREFIX}${sanitizeGroupNameForTag(groupName)}`;
}

function clearGroupTags(entity: Entity): void {
  for (const tag of entity.getTags()) {
    if (tag.startsWith(GROUP_TAG_PREFIX)) {
      entity.removeTag(tag);
    }
  }
}

export function listGroups(): string[] {
  ensureLoaded();
  return [...groups.keys()].sort((a, b) => a.localeCompare(b));
}

export function hasGroup(groupName: string): boolean {
  ensureLoaded();
  return groups.has(groupName);
}

export function createGroup(groupName: string): boolean {
  ensureLoaded();
  if (groups.has(groupName)) return false;
  groups.set(groupName, new Set<string>());
  save();
  return true;
}

export function deleteGroup(groupName: string): string[] | undefined {
  ensureLoaded();
  const members = groups.get(groupName);
  if (!members) return undefined;
  const ids = [...members.values()];
  groups.delete(groupName);
  save();
  return ids;
}

export function getGroupMembers(groupName: string): string[] {
  ensureLoaded();
  const ids = groups.get(groupName);
  if (!ids) return [];
  return [...ids.values()].sort((a, b) => a.localeCompare(b));
}

export function getGroupForRecord(recordId: string): string | undefined {
  ensureLoaded();
  for (const [groupName, members] of groups) {
    if (members.has(recordId)) return groupName;
  }
  return undefined;
}

export function setRecordGroup(recordId: string, groupName: string): void {
  ensureLoaded();

  for (const [, members] of groups) {
    members.delete(recordId);
  }

  let target = groups.get(groupName);
  if (!target) {
    target = new Set<string>();
    groups.set(groupName, target);
  }
  target.add(recordId);
  save();
}

export function clearRecordGroup(recordId: string): void {
  ensureLoaded();
  let changed = false;
  for (const [, members] of groups) {
    if (members.delete(recordId)) changed = true;
  }
  if (changed) save();
}

export function removeRecordFromGroups(recordId: string): void {
  clearRecordGroup(recordId);
}

export function syncEntityGroupMembership(entity: Entity, recordId: string): void {
  const groupName = getGroupForRecord(recordId);
  clearGroupTags(entity);

  if (!groupName) {
    entity.setDynamicProperty(ENTITY_GROUP_DP, undefined);
    return;
  }

  entity.setDynamicProperty(ENTITY_GROUP_DP, groupName);
  entity.addTag(groupTag(groupName));
}

export function clearEntityGroupMembership(entity: Entity): void {
  clearGroupTags(entity);
  entity.setDynamicProperty(ENTITY_GROUP_DP, undefined);
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const POLICY_NAMES = Object.freeze(['privacy', 'community']);

// policies.json is the single source for both the pages readers see and the
// versions people must have agreed to. Changing a version asks everyone again.
export function loadPolicyVersions(projectRoot) {
  const policies = JSON.parse(readFileSync(join(projectRoot, 'policies.json'), 'utf8'));
  return Object.freeze(Object.fromEntries(POLICY_NAMES.map((name) => {
    const version = String(policies[name]?.version || '').trim();
    if (!version) throw new Error(`policies.json is missing a version for "${name}".`);
    return [name, version];
  })));
}

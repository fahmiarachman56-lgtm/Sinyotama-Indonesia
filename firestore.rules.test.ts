import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 0 Rules Verification Checklist & Payload Contract Suite.
 * Validates that firestore.rules contains all required security gates for the Dirty Dozen payloads.
 */
const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');

const assertions: Array<{ name: string; check: boolean }> = [
  { name: 'Uses rules_version 2', check: /rules_version\s*=\s*'2';/.test(rulesContent) },
  { name: 'Has default-deny catch-all', check: /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rulesContent) },
  { name: 'Enforces email_verified == true', check: /request\.auth\.token\.email_verified == true/.test(rulesContent) },
  { name: 'Enforces path ID regex guard', check: /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/.test(rulesContent) },
  { name: 'Validates created_at == request.time', check: /incoming\(\)\.created_at == request\.time/.test(rulesContent) },
  { name: 'Validates updated_at == request.time', check: /incoming\(\)\.updated_at == request\.time/.test(rulesContent) },
  { name: 'Enforces terminal lock on submitted entries', check: /existing\(\)\.is_submitted == false/.test(rulesContent) },
  { name: 'Enforces workspace filter on list queries', check: /resource\.data\.workspace == 'sinyotama'/.test(rulesContent) },
  { name: 'Restricts admins collection writes to isAdmin()', check: /match \/admins\/\{uid\}[\s\S]*allow create: if isValidId\(uid\) &&\s*isAdmin\(\)[\s\S]*allow update: if false;[\s\S]*allow delete: if isValidId\(uid\) && isAdmin\(\);/.test(rulesContent) },
];

const failures = assertions.filter((a) => !a.check);
if (failures.length > 0) {
  console.error('Security rule assertion failures:', failures);
  process.exit(1);
}
console.log(`All ${assertions.length} Firestore security rule assertions passed.`);

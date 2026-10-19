// Server-side staff tool for operators with shell access, mainly to appoint
// the first administrator (after that, administrators use the Team page).
//   npm run staff -- grant-admin <mobile number> <name>
//   npm run staff -- list
// The number is only hashed with the server secret; it is never stored.
import { fingerprintPhone, normaliseMainlandPhone } from './auth-service.mjs';
import { config } from './config.mjs';
import { createDatabase } from './database.mjs';

const [command, ...args] = process.argv.slice(2);
const database = createDatabase(config.databasePath);

try {
  if (command === 'grant-admin') {
    const [phone, ...labelParts] = args;
    const normalisedPhone = normaliseMainlandPhone(phone);
    const label = labelParts.join(' ').trim();
    if (!normalisedPhone || label.length < 2 || label.length > 40) {
      throw new Error('Usage: npm run staff -- grant-admin <mainland mobile number> <name, 2-40 characters>');
    }
    database.setStaffRoleByPhone({
      phoneFingerprint: fingerprintPhone(config.authSecret, normalisedPhone),
      label,
      role: 'administrator',
      changedByAccountId: null,
      changedAt: new Date()
    });
    console.info(`${label} is now an administrator. They can sign in with that number to manage the team.`);
  } else if (command === 'list') {
    const staff = database.listStaff();
    if (!staff.length) console.info('No reviewers or administrators yet.');
    staff.forEach(({ label, role, since }) => {
      console.info(`${role.padEnd(13)} ${label || '(no name)'}${since ? `  since ${since}` : ''}`);
    });
  } else {
    throw new Error('Commands: grant-admin <mobile number> <name> | list');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  database.close();
}

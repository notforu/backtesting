#!/usr/bin/env tsx
/**
 * CLI script to create a new user.
 * Usage: npx tsx scripts/create-user.ts <username> <password> [role]
 */
import { initDb } from '../src/data/db.js';
import { createUser } from '../src/auth/db.js';

async function main() {
  const [,, username, password, role] = process.argv;

  if (!username || !password) {
    console.error('Usage: npx tsx scripts/create-user.ts <username> <password> [role]');
    console.error('  role: "admin" or "user" (default: "user")');
    process.exit(1);
  }

  const userRole = role === 'admin' ? 'admin' : 'user';

  await initDb();
  const user = await createUser(username, password, userRole);
  console.log(`User created: ${user.username} (${user.role}) id=${user.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

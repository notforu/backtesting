const PROD_URL = 'http://5.223.56.226';

async function main() {
  const loginResp = await fetch(`${PROD_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'admin' }),
  });
  const { token } = await loginResp.json() as { token: string };
  const h = { 'Authorization': `Bearer ${token}` };

  const sessionIds = [
    '7a1e330b-04cc-4a20-a33d-55a4ea5e9a7e',
    'a336fa82-27e3-4d57-b5ff-dae26c42fb8d',
    '731c842b-4922-4033-9974-5af35dda58f5',
  ];

  for (const id of sessionIds) {
    console.log(`Starting session ${id}...`);
    const resp = await fetch(`${PROD_URL}/api/paper-trading/sessions/${id}/start`, {
      method: 'POST',
      headers: h,
    });
    if (!resp.ok) {
      console.log(`  FAILED: ${await resp.text()}`);
    } else {
      console.log(`  OK: ${PROD_URL}/paper-trading/${id}`);
    }
  }
}
main();

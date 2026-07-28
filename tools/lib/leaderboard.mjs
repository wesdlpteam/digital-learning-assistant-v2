import fs from 'node:fs';

const FBHOOK = 'https://script.google.com/macros/s/AKfycbwFSbbn_1IaTst0ujfzBiQpE5pGpo07UL8yxemoHOudXzPHxKmKJvkgW2jvivf9yr9Alg/exec';

// Build-time only, run from Nathan's machine. On the Wesley network this can
// hit TLS interception; if it fails with "self-signed certificate in
// certificate chain", set NODE_EXTRA_CA_CERTS=~/wesley-corp-roots.pem.
export async function fetchLeaderboardSnapshot() {
  const res = await fetch(`${FBHOOK}?action=leaderboard&t=${Date.now()}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`leaderboard fetch failed: HTTP ${res.status}`);
  return res.json();
}

export function loadPreviousSnapshot(path) {
  if (!fs.existsSync(path)) {
    throw new Error(
      `--no-leaderboard was given but ${path} does not exist yet. ` +
      'Run once with network access to capture the first snapshot.'
    );
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

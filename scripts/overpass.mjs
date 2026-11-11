/** Appel de l'API Overpass, partagé par les scripts de récolte. */

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Overpass refuse les clients anonymes : on s'identifie, comme sa charte le demande.
const USER_AGENT = 'louy-harvest/1.0 (+https://github.com/alanhortz/louy)';

export async function overpass(query) {
  let failure;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error(`${endpoint} → HTTP ${response.status}`);
      const text = await response.text();
      if (text.trim().length === 0) throw new Error(`${endpoint} → réponse vide`);
      return text;
    } catch (error) {
      failure = error;
      console.warn(`  ${error.message} — nouvel essai`);
    }
  }
  throw failure;
}

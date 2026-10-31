export async function choosePort({ preferred, blocked, isOpen, start, end }) {
  const candidates = [];
  if (Number.isInteger(preferred)) candidates.push(preferred);
  for (let port = start; port <= end; port += 1) candidates.push(port);
  const seen = new Set();
  for (const port of candidates) {
    if (seen.has(port)) continue;
    seen.add(port);
    if (!Number.isInteger(port) || port < start || port > end) continue;
    if (blocked.has(port)) continue;
    if (await isOpen(port)) continue;
    return port;
  }
  return null;
}

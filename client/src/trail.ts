// A short memory of what the player just did and saw, in words, attached to every playtest reaction.
import { listen } from './events';

const MAX = 40;
const start = Date.now();
export const trail: { s: number; e: string }[] = [];

function words(kind: string, d: any): string | undefined {
  switch (kind) {
    case 'call': return d; // net.ts already says it in words: "sell Skeleton (slot 1)"
    case 'rejected': return `  rejected: ${d}`;
    case 'toast': return `saw: "${d}"`;
    case 'screen': return `screen: ${d}`;
    case 'battle': return `battle round ${d.round} vs ${d.opp} starts (result: ${d.result})`;
    case 'js-error': return `js error: ${d}`;
  }
}

listen((kind, d) => {
  const e = words(kind, d);
  if (!e) return;
  trail.push({ s: Math.round((Date.now() - start) / 100) / 10, e });
  if (trail.length > MAX) trail.shift();
});

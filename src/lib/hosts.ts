import { DEV_APP_HOSTS, STORAGE_KEY_AUTHORIZED } from '@/config/app-hosts';

export function normalizeOriginInput(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Informe a URL da instância');
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProto).origin;
}

export function originToPattern(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/*`;
}

export function patternsFromOrigins(origins: string[]): string[] {
  return [...new Set(origins.map(originToPattern))];
}

export function mergeHostPatterns(
  defaults: string[],
  storedOrigins: string[],
): string[] {
  return [...new Set([...defaults, ...patternsFromOrigins(storedOrigins)])];
}

function patternMatchesUrl(pattern: string, url: string): boolean {
  if (pattern.endsWith('/*')) {
    return url.startsWith(pattern.slice(0, -1));
  }
  const wildcard = pattern.match(/^(https?):\/\/\*\.([^/]+)(\/.*)?$/);
  if (wildcard) {
    const [, proto, host] = wildcard;
    try {
      const u = new URL(url);
      return (
        u.protocol === `${proto}:` &&
        (u.hostname === host || u.hostname.endsWith(`.${host}`))
      );
    } catch {
      return false;
    }
  }
  return url === pattern;
}

export async function readStoredOrigins(): Promise<string[]> {
  if (!chrome.storage?.local) return [];
  const data = await chrome.storage.local.get(STORAGE_KEY_AUTHORIZED);
  const list = data[STORAGE_KEY_AUTHORIZED];
  return Array.isArray(list) ? (list as string[]) : [];
}

export async function saveStoredOrigins(origins: string[]): Promise<void> {
  if (!chrome.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEY_AUTHORIZED]: origins });
}

export async function getAllHostPatterns(): Promise<string[]> {
  const stored = await readStoredOrigins();
  return mergeHostPatterns(DEV_APP_HOSTS, stored);
}

export async function urlIsAuthorizedAppUrl(url: string): Promise<boolean> {
  const patterns = await getAllHostPatterns();
  return patterns.some((p) => patternMatchesUrl(p, url));
}

export { STORAGE_KEY_AUTHORIZED };

/**
 * Accept only HTTPS Google Maps links, and return the trimmed input unchanged.
 * A shortened `maps.app.goo.gl` link is not rewritten into a search URL.
 */
const MAPS_PATH = /^\/maps(\/|$)/;

function isGoogleHost(host: string): boolean {
  return (
    host === 'google.com' ||
    host === 'www.google.com' ||
    /^www\.google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host)
  );
}

function isMapsGoogleHost(host: string): boolean {
  return /^maps\.google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host);
}

export function acceptedGoogleMapsUrl(
  value: string | null | undefined,
): string | null {
  const text = value?.trim() ?? '';
  if (!text || text.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const shortLink = host === 'maps.app.goo.gl' && url.pathname.length > 1;
  const mapsHost = isMapsGoogleHost(host);
  const googleMapsPath = isGoogleHost(host) && MAPS_PATH.test(url.pathname);
  if (!shortLink && !mapsHost && !googleMapsPath) return null;
  return text;
}

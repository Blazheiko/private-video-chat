import { validateFragmentKey } from '@shared';

export function readAndClearFragmentKey(location: Location, history: History): string | undefined {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(hash);
  const key = params.get('k');

  if (key === null) {
    return undefined;
  }

  const parsed = validateFragmentKey(key);

  history.replaceState(history.state, '', `${location.pathname}${location.search}`);

  return parsed.ok ? parsed.value : undefined;
}

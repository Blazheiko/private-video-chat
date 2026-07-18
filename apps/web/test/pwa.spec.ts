import { describe, expect, it } from 'vitest';
import { isAppleMobileDevice } from '@web/pwa.js';

describe('isAppleMobileDevice', () => {
  it('detects iPhone and iPad user agents', () => {
    expect(isAppleMobileDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 0)).toBe(true);
    expect(isAppleMobileDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 0)).toBe(true);
  });

  it('detects iPadOS desktop-mode Safari by touch support', () => {
    expect(
      isAppleMobileDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
        5,
      ),
    ).toBe(true);
  });

  it('does not classify desktop browsers without Apple mobile signals as iOS/iPadOS', () => {
    expect(isAppleMobileDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false);
    expect(isAppleMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 0)).toBe(false);
  });
});

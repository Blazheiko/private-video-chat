export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    });
  });
}

export function isAppleMobileDevice(
  userAgent = navigator.userAgent,
  maxTouchPoints = navigator.maxTouchPoints,
): boolean {
  const ua = userAgent.toLowerCase();
  const isIphoneOrIpad = /iphone|ipad|ipod/.test(ua);
  const isIpadOsDesktopMode = /macintosh/.test(ua) && maxTouchPoints > 1;

  return isIphoneOrIpad || isIpadOsDesktopMode;
}

export function isStandalonePwa(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone);
}

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

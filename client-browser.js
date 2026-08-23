export function isMobileZaloBrowser(userAgent = '') {
  const ua = String(userAgent || '');
  const isZalo = /Zalo/i.test(ua);
  const isMobile = /(Android|iPhone|iPad|iPod|Mobile)/i.test(ua);
  return isZalo && isMobile;
}

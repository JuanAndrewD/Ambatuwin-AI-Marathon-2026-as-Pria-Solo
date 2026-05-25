// Trivial hash-based router. Routes:
//   #/             → Landing
//   #/app          → Workspace
//   #/services     → Service library
//   #/services/:name → Service detail page
import { useEffect, useState, useCallback } from 'react';

function parse() {
  const raw = (window.location.hash || '#/').replace(/^#/, '');
  const [pathPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return { path: '/' + segments.join('/'), segments, raw };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const handler = () => setRoute(parse());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return route;
}

export function navigate(path) {
  if (!path.startsWith('#')) path = '#' + (path.startsWith('/') ? path : '/' + path);
  if (window.location.hash === path) return;
  window.location.hash = path;
}

export function useNavigate() {
  return useCallback(navigate, []);
}

// Routeur par hash (#/calendrier, #/seance/<id>, ...). Chemins relatifs, compatible GitHub Pages.
const routes = [];
let token = 0;

// register('/seance/:id', handler, {admin:true})
export function register(pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([0-9a-fA-F-]{36})'; }) + '$');
  routes.push({ re, keys, handler, opts });
}

export const currentPath = () => (location.hash.replace(/^#/, '') || '/calendrier');

export function go(path) {
  if (location.hash === '#' + path) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#' + path;
}

// Résout la route courante. Retourne {match, token} ; ctx.isStale() permet d'ignorer un rendu obsolète.
export function resolve(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
      return { route: r, params };
    }
  }
  return null;
}

export function nextToken() { return ++token; }
export const isCurrent = (t) => t === token;

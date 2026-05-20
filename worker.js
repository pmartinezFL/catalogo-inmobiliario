import { onRequest as handleProperty } from './functions/api/property.js';
import { onRequest as handlePublish }  from './functions/api/publish.js';
import { onRequest as handleCatalog }  from './functions/c/[id].js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/property') {
      return handleProperty({ request, env, ctx, params: {} });
    }
    if (pathname === '/api/publish') {
      return handlePublish({ request, env, ctx, params: {} });
    }
    const m = pathname.match(/^\/c\/([A-Za-z0-9]+)$/);
    if (m) {
      return handleCatalog({ request, env, ctx, params: { id: m[1] } });
    }

    return env.ASSETS.fetch(request);
  },
};

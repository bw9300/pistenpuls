// Cloudflare Workers: static files come from ./dist (wrangler.jsonc › assets); everything else goes to the API.
import { app } from './app';

export default app;

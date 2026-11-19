import 'dotenv/config';
import express, { type Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    const parsed = Number(process.argv[idx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const eqArg = process.argv.find((a) => a.startsWith('--port='));
  if (eqArg) {
    const parsed = Number(eqArg.split('=')[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (process.env.NODE_ENV !== 'production') {
    return 3000;
  }
  return Number(process.env.PORT || 3000);
}

async function startServer() {
  const app = express();
  const PORT = resolvePort();

  app.disable('x-powered-by');

  // Security headers (v4 §48, §87)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Immediate liveness route so startup probes succeed without waiting for Vite/SDK imports
  app.get('/api/v1/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      service: 'suwaseva-clinic-api',
      apiVersion: 'v1',
      timestamp: new Date().toISOString(),
    });
  });

  let apiRouter: Router | null = null;
  let viteMiddleware: express.RequestHandler | null = null;
  let initError: unknown = null;

  const initPromise = (async () => {
    const [{ apiV1Router }, viteMod] = await Promise.all([
      import('./src/routes/api-v1.ts'),
      process.env.NODE_ENV !== 'production' ? import('vite') : Promise.resolve(null),
    ]);
    apiRouter = apiV1Router;

    if (viteMod) {
      const vite = await viteMod.createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      viteMiddleware = vite.middlewares;
    }
  })().catch((err) => {
    initError = err;
    console.error('Server subsystem initialization failed:', err);
  });

  app.use('/api/v1', async (req, res, next) => {
    await initPromise;
    if (initError || !apiRouter) {
      return res.status(503).json({
        code: 'SERVICE_INITIALIZING_ERROR',
        messageKey: 'errors.internal',
        message: 'API subsystem failed to initialize.',
        retryable: true,
      });
    }
    return apiRouter(req, res, next);
  });

  if (process.env.NODE_ENV !== 'production') {
    app.use(async (req, res, next) => {
      await initPromise;
      if (initError || !viteMiddleware) {
        return next(initError || new Error('Vite middleware unavailable'));
      }
      return viteMiddleware(req, res, next);
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SuwaSeva Clinic Workspace listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

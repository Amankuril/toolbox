import crypto from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '#config/logger.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export const requestLogger = pinoHttp({
  logger,
  // Honour an upstream request id (nginx $request_id) so logs can be correlated end to end.
  genReqId(req, res) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: { ignore: (req) => req.url.startsWith('/health') },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: req.remoteAddress }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

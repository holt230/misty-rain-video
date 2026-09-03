import crypto from 'node:crypto';

export const readRequestBody = async (request, limitBytes = 1024 * 1024) => {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error('请求内容过大');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('请求 JSON 格式无效');
    error.statusCode = 400;
    throw error;
  }
};

export const sendJson = (response, statusCode, payload) => {
  if (response.headersSent || response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
};

export const sendSuccess = (response, data, message) => {
  sendJson(response, 200, { code: 0, ...(message ? { message } : {}), data });
};

export const sendError = (response, error) => {
  const statusCode = Number(error?.statusCode) || 500;
  const code = error?.code || (statusCode === 401 ? 'QUARK_AUTH_REQUIRED' : 'INTERNAL_ERROR');
  const publicMessage = String(error?.message || '服务暂时不可用')
    .replace(/夸克\s*(?:SVIP|会员)?/gi, '播放服务')
    .replace(/\bSVIP\b/gi, '高清播放');
  sendJson(response, statusCode, {
    code,
    message: error?.expose === false ? '服务暂时不可用' : publicMessage
  });
};

export const createOpaqueId = () => crypto.randomBytes(18).toString('base64url');

export const copyProxyHeaders = (upstream, response) => {
  const allowed = [
    'accept-ranges',
    'cache-control',
    'content-disposition',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified'
  ];
  for (const name of allowed) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  response.setHeader('X-Content-Type-Options', 'nosniff');
};

const DEFAULT_PROXY_IDLE_TIMEOUT_MS = 30_000;

const createProxyAbortError = message => Object.assign(new Error(message), {
  name: 'AbortError',
  code: 'STREAM_PROXY_ABORTED'
});

const readWithIdleTimeout = async (reader, idleTimeoutMs) => {
  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = Object.assign(new Error('媒体分片长时间没有返回数据'), {
            code: 'STREAM_IDLE_TIMEOUT',
            statusCode: 504
          });
          reject(error);
        }, idleTimeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const waitForDrain = response => new Promise((resolve, reject) => {
  if (typeof response.once !== 'function') {
    resolve();
    return;
  }
  const cleanup = () => {
    response.off?.('drain', handleDrain);
    response.off?.('close', handleClose);
    response.off?.('error', handleError);
  };
  const handleDrain = () => {
    cleanup();
    resolve();
  };
  const handleClose = () => {
    cleanup();
    reject(createProxyAbortError('客户端已断开'));
  };
  const handleError = error => {
    cleanup();
    reject(error);
  };
  response.once('drain', handleDrain);
  response.once('close', handleClose);
  response.once('error', handleError);
});

export const readWebResponseText = async (upstream, options = {}) => {
  if (!upstream.body) return '';
  const idleTimeoutMs = Math.max(1, Number(options.idleTimeoutMs) || DEFAULT_PROXY_IDLE_TIMEOUT_MS);
  const maxBytes = Math.max(1, Number(options.maxBytes) || 2 * 1024 * 1024);
  const reader = upstream.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw Object.assign(new Error('媒体清单内容异常'), {
          code: 'STREAM_MANIFEST_TOO_LARGE',
          statusCode: 502
        });
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }
};

export const pipeWebResponse = async (upstream, response, options = {}) => {
  response.statusCode = upstream.status;
  copyProxyHeaders(upstream, response);
  if (!upstream.body) {
    response.end();
    return { bytes: 0, durationMs: 0 };
  }

  const idleTimeoutMs = Math.max(1, Number(options.idleTimeoutMs) || DEFAULT_PROXY_IDLE_TIMEOUT_MS);
  const startedAt = Date.now();
  const reader = upstream.body.getReader();
  let bytes = 0;
  let downstreamClosed = false;
  const handleClose = () => {
    if (response.writableEnded) return;
    downstreamClosed = true;
    reader.cancel(createProxyAbortError('客户端已断开')).catch(() => {});
  };
  response.once?.('close', handleClose);

  try {
    while (true) {
      const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs);
      if (done) break;
      if (downstreamClosed) break;
      bytes += value.byteLength;
      if (!response.write(Buffer.from(value))) {
        await waitForDrain(response);
      }
    }
    if (!downstreamClosed && !response.writableEnded) response.end();
    return { bytes, durationMs: Date.now() - startedAt };
  } catch (error) {
    reader.cancel().catch(() => {});
    if (!downstreamClosed && !response.destroyed) response.destroy(error);
    throw error;
  } finally {
    response.off?.('close', handleClose);
  }
};

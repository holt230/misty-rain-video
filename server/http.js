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
  if (response.headersSent) return;
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

export const pipeWebResponse = async (upstream, response) => {
  response.statusCode = upstream.status;
  copyProxyHeaders(upstream, response);
  if (!upstream.body) {
    response.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) {
        await new Promise(resolve => response.once('drain', resolve));
      }
    }
    response.end();
  } catch (error) {
    reader.cancel().catch(() => {});
    if (!response.destroyed) response.destroy(error);
  }
};

/** 统一构建、隧道地址和服务端路由使用的部署路径；根路径以空字符串表示。 */
export const normalizeBasePath = value => {
  const base = String(value || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(base)) {
    throw new Error('APP_BASE_PATH 必须是 /misty/ 这样的站内路径');
  }
  return base;
};

/** 隧道转发保留原始路径，在进入 API 和静态文件处理前剥离部署前缀。 */
export const handleBasePath = (request, response, base) => {
  if (!base) return false;
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname === base || url.pathname === '/') {
    response.statusCode = 308;
    response.setHeader('Location', `${base}/${url.search}`);
    response.end();
    return true;
  }
  if (url.pathname.startsWith(`${base}/`)) {
    request.url = `${url.pathname.slice(base.length)}${url.search}`;
    request.headers['x-forwarded-prefix'] = base;
    return false;
  }
  // 本地进程管理和容器健康检查始终使用固定的健康端点。
  if (url.pathname === '/api/health') return false;
  response.statusCode = 404;
  response.end('Not Found');
  return true;
};

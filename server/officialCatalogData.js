import { parse as parseHtml } from 'parse5';
import { babelParse } from 'vue/compiler-sfc';

export const PLATFORM_NAMES = Object.freeze({ qq: '腾讯视频', mango: '芒果TV', youku: '优酷', iqiyi: '爱奇艺' });
export const CATALOG_CHANNELS = ['tv', 'movie', 'anime', 'variety', 'new'];
export const cleanText = (value, length = 240) => String(value ?? '').replace(/<[^>]*>/g, '').normalize('NFKC').trim().slice(0, length);
export const titleKey = value => cleanText(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const validCatalogId = value => /^(?:\d{1,20}|douban:\d{1,20}|work:[a-f0-9]{24}|(?:qq|mango|youku|iqiyi):[a-zA-Z0-9_-]{1,80})$/.test(value);
export const catalogIdFromPath = value => {
  try { const id = decodeURIComponent(value); return validCatalogId(id) ? id : ''; } catch { return ''; }
};

export function artworkUrl(value) {
  try {
    const url = new URL(String(value || '').replace(/^\/\//, 'https://'));
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password) return '';
    if (!/^(?:[a-z0-9-]+\.)*(?:qpic\.cn|gtimg\.cn|gtimg\.com|iqiyipic\.com|hitv\.com|alicdn\.com)$/.test(url.hostname)) return '';
    if (/\.svg(?:$|[?#])|\.gif(?:$|[?#])/i.test(url.href)) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}

export function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return '';
}

/** Read only data syntax. Calls, property access and executable statements are never evaluated. */
export function decodeDataExpression(root) {
  let remaining = 150_000;
  const decode = (node, scope = new Map(), depth = 0) => {
    if (!node || depth > 100 || --remaining < 0) throw new Error('页面数据过大');
    const next = value => decode(value, scope, depth + 1);
    if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
    if (node.type === 'NullLiteral') return null;
    if (node.type === 'Identifier') {
      if (node.name === 'undefined') return undefined;
      if (scope.has(node.name)) return scope.get(node.name);
      throw new Error('页面数据包含未知引用');
    }
    if (node.type === 'UnaryExpression' && node.operator === 'void' && node.argument.type === 'NumericLiteral') return undefined;
    if (node.type === 'UnaryExpression' && ['-', '+'].includes(node.operator) && node.argument.type === 'NumericLiteral') return node.operator === '-' ? -node.argument.value : node.argument.value;
    if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && scope.has(node.object.name)) {
      const key = node.property.name;
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('页面数据属性无效');
      const target = scope.get(node.object.name);
      if (!target || typeof target !== 'object') throw new Error('页面数据引用无效');
      return target[key];
    }
    if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'MemberExpression'
      && !node.left.computed && node.left.object.type === 'Identifier' && scope.has(node.left.object.name)) {
      const key = node.left.property.name;
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('页面数据属性无效');
      const target = scope.get(node.left.object.name);
      if (!target || typeof target !== 'object') throw new Error('页面数据引用无效');
      return target[key] = next(node.right);
    }
    if (node.type === 'ArrayExpression') return node.elements.map(value => value ? next(value) : null);
    if (node.type === 'ObjectExpression') {
      const result = Object.create(null);
      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || property.computed || property.method) throw new Error('页面数据包含可执行属性');
        const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
        if (['__proto__', 'prototype', 'constructor'].includes(String(key))) throw new Error('页面数据属性无效');
        result[key] = next(property.value);
      }
      return result;
    }
    // Some SSR serializers use a function with object initialization and a data return to share
    // empty objects/arrays. Interpret this restricted grammar without running JS.
    if (node.type === 'CallExpression' && node.callee.type === 'FunctionExpression') {
      const fn = node.callee;
      if (fn.async || fn.generator || fn.params.some(value => value.type !== 'Identifier') || !fn.body.body.length || fn.body.body.at(-1).type !== 'ReturnStatement'
        || fn.body.body.slice(0, -1).some(statement => statement.type !== 'ExpressionStatement' || statement.expression.type !== 'AssignmentExpression')
        || node.arguments.some(value => value.type === 'SpreadElement')) throw new Error('页面包含非数据脚本');
      const local = new Map(scope);
      fn.params.forEach((param, index) => local.set(param.name, node.arguments[index] ? next(node.arguments[index]) : undefined));
      for (const statement of fn.body.body.slice(0, -1)) decode(statement.expression, local, depth + 1);
      return decode(fn.body.body.at(-1).argument, local, depth + 1);
    }
    throw new Error('页面包含非数据脚本');
  };
  return decode(root);
}

export function scriptData(html, name) {
  if (html.length > 4 * 1024 * 1024) throw new Error('页面数据过大');
  const document = parseHtml(html);
  let result, found = false;
  const walk = node => {
    if (node.tagName === 'script') {
      const source = (node.childNodes || []).map(child => child.value || '').join('');
      if (source.trimStart().startsWith('window.' + name)) {
        const ast = babelParse(source, { sourceType: 'script' });
        for (const statement of ast.program.body) {
          const assignment = statement.type === 'ExpressionStatement' && statement.expression;
          let left = assignment?.left;
          const keys = [];
          while (left?.type === 'MemberExpression' && !left.computed && left.property.type === 'Identifier') {
            keys.unshift(left.property.name); left = left.object;
          }
          if (assignment?.type === 'AssignmentExpression' && assignment.operator === '=' && left?.type === 'Identifier'
            && left.name === 'window' && keys[0] === name) {
            if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('页面数据属性无效');
            const value = decodeDataExpression(assignment.right);
            if (keys.length === 1) {
              if (found) throw new Error('页面包含重复数据');
              result = value; found = true;
            } else {
              if (!found || !result || typeof result !== 'object') throw new Error('页面数据顺序无效');
              let target = result;
              for (const key of keys.slice(1, -1)) {
                if (!target[key] || typeof target[key] !== 'object') target[key] = Object.create(null);
                target = target[key];
              }
              target[keys.at(-1)] = value;
            }
          }
        }
      }
    }
    for (const child of node.childNodes || []) walk(child);
  };
  walk(document);
  if (!found) throw new Error('页面未返回片单数据');
  return result;
}

export function walkObjects(data, visit) {
  let count = 0;
  const walk = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 60 || ++count > 100_000) return;
    if (!Array.isArray(value)) visit(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, depth + 1);
  };
  walk(data, 0);
}

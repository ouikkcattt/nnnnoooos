/**
 * OVO Discord 登录门槛（前端启动器）
 * - 先请求 /api/me 判断是否已登录（由 Cloudflare Worker 提供）
 * - 已登录：加载 ovo-script.js（保证其 DOMContentLoaded 初始化能正常触发）
 * - 未登录/无权限：显示遮罩并引导去 /auth/discord
 *
 * 说明：
 * - 这是“门槛 + 体验”层；真正权限校验在 Worker。
 * - 仅靠前端无法绝对防绕过，但能显著提高门槛并做统一入口体验。
 */

const AUTH_ME_URL = '/api/me';
const AUTH_LOGIN_URL = '/auth/discord';

// 网络差时避免“白屏”：检查会重试 + 超时
const ME_TIMEOUT_MS = 4500;
const ME_RETRIES = 2;
const RETRY_BACKOFF_MS = [250, 800];

// 可选：如果鉴权服务暂时不可用，但本地缓存仍未过期，允许“离线继续”
// 注意：这属于体验兜底，会降低门槛的“强制性”（默认关闭）。
const ALLOW_OFFLINE_FALLBACK = false;
const OFFLINE_CACHE_KEY = 'ovo_auth_cache_v1';

function formatFetchError(err) {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name || '') : '';
  const msg = err && typeof err === 'object' && 'message' in err ? String(err.message || '') : String(err || '');
  if (name === 'AbortError') return '请求超时';
  if (name && msg) return `${name}: ${msg}`;
  return name || msg || '未知错误';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch (_) {
    return null;
  }
}

function getCachedMe() {
  try {
    const cached = safeJsonParse(localStorage.getItem(OFFLINE_CACHE_KEY));
    if (!cached || cached.ok !== true || !cached.user || !cached.exp) return null;
    if (typeof cached.exp !== 'number') return null;
    if (cached.exp <= nowSec()) return null;
    return cached;
  } catch (_) {
    return null;
  }
}

function setCachedMe(me) {
  try {
    if (!me || me.ok !== true || !me.user || !me.exp) return;
    const payload = {
      ok: true,
      user: {
        id: String(me.user.id || ''),
        name: String(me.user.name || ''),
        avatar: String(me.user.avatar || '')
      },
      exp: Number(me.exp) || 0,
      cachedAt: new Date().toISOString()
    };
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function removeGate() {
  const el = document.getElementById('ovoAuthGate');
  if (el) el.remove();
}

function renderGate({ title, message, footnote, primaryText, primaryHref, secondaryText, secondaryOnClick } = {}) {
  removeGate();

  const gate = document.createElement('div');
  gate.id = 'ovoAuthGate';
  gate.style.position = 'fixed';
  gate.style.inset = '0';
  gate.style.zIndex = '2147483647';
  gate.style.background = 'rgba(0,0,0,0.72)';
  gate.style.backdropFilter = 'blur(10px)';
  gate.style.display = 'flex';
  gate.style.alignItems = 'center';
  gate.style.justifyContent = 'center';
  gate.style.padding = '20px';

  const card = document.createElement('div');
  card.style.width = 'min(420px, 92vw)';
  card.style.borderRadius = '18px';
  card.style.background = 'rgba(18,18,18,0.92)';
  card.style.border = '1px solid rgba(255,255,255,0.12)';
  card.style.boxShadow = '0 20px 60px rgba(0,0,0,0.55)';
  card.style.padding = '18px';

  const h = document.createElement('div');
  h.textContent = title || '需要 Discord 登录';
  h.style.fontSize = '18px';
  h.style.fontWeight = '800';
  h.style.color = '#fff';
  h.style.marginBottom = '8px';

  const p = document.createElement('div');
  p.textContent = message || '仅限服务器指定身份组成员进入。';
  p.style.fontSize = '14px';
  p.style.color = 'rgba(255,255,255,0.78)';
  p.style.lineHeight = '1.6';
  p.style.marginBottom = '14px';

  let f = null;
  if (footnote) {
    f = document.createElement('div');
    f.textContent = String(footnote);
    f.style.fontSize = '12px';
    f.style.color = 'rgba(255,255,255,0.55)';
    f.style.lineHeight = '1.5';
    f.style.marginTop = '-8px';
    f.style.marginBottom = '14px';
  }

  const actions = document.createElement('div');
  actions.style.display = 'grid';
  actions.style.gap = '10px';

  const primary = document.createElement(primaryHref ? 'a' : 'button');
  primary.textContent = primaryText || '使用 Discord 登录';
  primary.style.display = 'inline-flex';
  primary.style.alignItems = 'center';
  primary.style.justifyContent = 'center';
  primary.style.width = '100%';
  primary.style.height = '44px';
  primary.style.borderRadius = '12px';
  primary.style.background = '#5865F2';
  primary.style.color = '#fff';
  primary.style.fontWeight = '800';
  primary.style.textDecoration = 'none';
  primary.style.border = 'none';
  primary.style.cursor = 'pointer';
  if (primaryHref) primary.href = primaryHref;

  actions.appendChild(primary);

  if (secondaryText) {
    const secondary = document.createElement('button');
    secondary.textContent = secondaryText;
    secondary.style.display = 'inline-flex';
    secondary.style.alignItems = 'center';
    secondary.style.justifyContent = 'center';
    secondary.style.width = '100%';
    secondary.style.height = '44px';
    secondary.style.borderRadius = '12px';
    secondary.style.background = 'rgba(255,255,255,0.10)';
    secondary.style.color = 'rgba(255,255,255,0.92)';
    secondary.style.fontWeight = '700';
    secondary.style.border = '1px solid rgba(255,255,255,0.12)';
    secondary.style.cursor = 'pointer';
    secondary.addEventListener('click', () => {
      try { secondaryOnClick && secondaryOnClick(); } catch (_) {}
    });
    actions.appendChild(secondary);
  }

  card.appendChild(h);
  card.appendChild(p);
  if (f) card.appendChild(f);
  card.appendChild(actions);
  gate.appendChild(card);
  document.documentElement.appendChild(gate);
}

function buildLoginHref() {
  const next = location.pathname + location.search + location.hash;
  return `${AUTH_LOGIN_URL}?next=${encodeURIComponent(next)}`;
}

async function fetchWithTimeout(url, { timeoutMs, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 1));
  try {
    const res = await fetch(url, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getMeWithRetries() {
  let lastErr = null;

  for (let attempt = 0; attempt <= ME_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(AUTH_ME_URL, { timeoutMs: ME_TIMEOUT_MS });
      if (!res.ok) return { ok: false, status: res.status };
      const data = await res.json();
      if (data && data.ok === true) return { ok: true, data };
      return { ok: false, status: 401 };
    } catch (err) {
      lastErr = err;
      if (attempt < ME_RETRIES) {
        const delay = RETRY_BACKOFF_MS[attempt] ?? 800;
        await sleep(delay);
        continue;
      }
      return { ok: false, error: lastErr };
    }
  }

  return { ok: false, error: lastErr };
}

async function loadClassicScript(src) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`load failed: ${src}`));
    document.head.appendChild(s);
  });
}

function renderChecking() {
  renderGate({
    title: '正在检查权限…',
    message: '第一次加载会进行 Discord 登录校验，请稍等。',
    primaryText: '正在检查…',
    primaryHref: null
  });

  const primary = document.querySelector('#ovoAuthGate button');
  if (primary) {
    primary.disabled = true;
    primary.style.opacity = '0.75';
    primary.style.cursor = 'default';
  }
}

function renderNeedLogin() {
  renderGate({
    title: '需要 Discord 登录',
    message: '仅限服务器指定身份组成员进入。每两周需要重新登陆。',
    footnote: '透明说明：我们会记录你的 Discord 账号ID、昵称、登录时间，以及登录次数统计（按天，仅计数）（仅用于鉴权与溯源）。',
    primaryText: '使用 Discord 登录',
    primaryHref: buildLoginHref()
  });
}

function renderDenied() {
  renderGate({
    title: '无权限',
    message: '你已登录，但不在允许的身份组内（或未加入服务器）。',
    primaryText: '重新登录',
    primaryHref: buildLoginHref()
  });
}

function renderError({ allowOffline, message } = {}) {
  const offlineHint = allowOffline ? '你也可以选择“离线继续”（若你近期登录过）。' : '请检查网络后重试。';
  renderGate({
    title: '鉴权服务不可用',
    message: message || `当前无法连接鉴权服务，可能是网络波动或 Cloudflare 临时故障。\n${offlineHint}`,
    primaryText: '重试',
    primaryHref: null,
    secondaryText: allowOffline ? '离线继续' : null,
    secondaryOnClick: allowOffline ? async () => {
      const cached = getCachedMe();
      if (!cached) return;
      window.__OVO_AUTH__ = { ...cached, offline: true };
      removeGate();
      await loadClassicScript('./ovo-script.js');
    } : null
  });

  const primary = document.querySelector('#ovoAuthGate button');
  if (primary) {
    primary.addEventListener('click', async () => {
      renderChecking();
      await main();
    }, { once: true });
  }
}

async function main() {
  const url = new URL(location.href);
  const authResult = url.searchParams.get('auth');
  const host = location.hostname;
  const rootHost = host.startsWith('www.') ? host.slice(4) : host;
  const wwwHost = `www.${rootHost}`;

  // 给回调落地的用户更明确的提示
  if (authResult === 'denied') {
    renderDenied();
    return;
  }
  if (authResult === 'error') {
    renderGate({
      title: '登录回调失败',
      message:
        `这表示 Discord OAuth 回调校验失败（state/cookie 丢失），不是网络波动。\n` +
        `最常见原因：在 ${rootHost} 和 ${wwwHost} 之间来回跳，导致 Cookie 对不上。\n\n` +
        `请按顺序做：\n` +
        `1) 只用 https://${rootHost}/index.html 进入\n` +
        `2) 把 https://${wwwHost} 全部 301 跳到 https://${rootHost}\n` +
        `3) 清理站点 Cookie（${rootHost} 和 ${wwwHost}）后重试登录\n` +
        `4) Discord Redirect URI 只保留 https://${rootHost}/auth/callback（或同时把 www 的也加上）`,
      primaryText: '重新登录',
      primaryHref: buildLoginHref()
    });
    return;
  }

  renderChecking();

  const me = await getMeWithRetries();
  if (me.ok) {
    window.__OVO_AUTH__ = me.data;
    setCachedMe(me.data);
    removeGate();
    await loadClassicScript('./ovo-script.js');
    return;
  }

  if (me.error) {
    const target = `${location.origin}${AUTH_ME_URL}`;
    const errText = formatFetchError(me.error);
    const cached = getCachedMe();
    const allowOffline = ALLOW_OFFLINE_FALLBACK && !!cached;
    renderError({
      allowOffline,
      message: `无法请求鉴权接口：${target}\n错误：${errText}\n你可以在新标签页直接打开这个地址，确认是否能返回 JSON（例如 {"ok":false}）。`
    });
    return;
  }

  if (me.status === 401) {
    renderNeedLogin();
    return;
  }

  if (me.status === 403) {
    renderDenied();
    return;
  }

  const cached = getCachedMe();
  const allowOffline = ALLOW_OFFLINE_FALLBACK && !!cached;
  if (me.status === 404) {
    renderError({
      allowOffline,
      message: `鉴权接口未部署或路由未生效（/api/me 返回 404）。\n请检查 Cloudflare Worker Routes 是否已绑定：\n- 你的域名/auth/*\n- 你的域名/api/*\n并确保 DNS 为橙云代理。`
        .replaceAll('你的域名', host)
    });
    return;
  }
  if (typeof me.status === 'number' && me.status >= 500) {
    renderError({
      allowOffline,
      message: `鉴权服务异常（HTTP ${me.status}）。\n${allowOffline ? '你也可以选择“离线继续”（若你近期登录过）。' : '请稍后重试。'}`
    });
    return;
  }
  renderError({ allowOffline });
}

// 作为 module 加载时，top-level await 会阻塞 DOMContentLoaded，
// 确保我们在 DOMContentLoaded 前注入 ovo-script.js（避免其初始化丢失）。
await main();

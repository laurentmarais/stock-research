import { EventEmitter } from 'events';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

function isRunningInDocker() {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

function shouldForceHeadless() {
  if (process.env.DISCORD_FORCE_HEADED === '1') return false;
  if (process.env.DISCORD_FORCE_HEADLESS === '1') return true;

  // On macOS/Windows, Playwright headed does not rely on $DISPLAY.
  if (process.platform !== 'linux') return false;

  // In container/CI Linux, there is usually no X server; headed will fail.
  if (isRunningInDocker()) return true;
  if (process.env.CI) return true;

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAbsoluteUrl(urlOrPath) {
  if (typeof urlOrPath !== 'string') return '';
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) return urlOrPath;
  if (urlOrPath.startsWith('/')) return `https://discord.com${urlOrPath}`;
  return urlOrPath;
}

function parseDiscordChannelHref(href) {
  // /channels/<guildId>/<channelId>
  if (typeof href !== 'string') return null;
  const m = href.match(/^\/channels\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const guildId = m[1];
  const channelId = m[2];
  if (!guildId || !channelId) return null;
  return { guildId, channelId };
}

function extractUrlsFromText(text) {
  const s = String(text || '');
  if (!s) return [];
  const re = /https?:\/\/[^\s<>()\[\]{}"']+/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(s))) {
    const raw = m[0];
    const trimmed = raw.replace(/[\]\)}>,.;:!?]+$/g, '');
    if (trimmed && /^https?:\/\//i.test(trimmed)) out.add(trimmed);
  }
  return Array.from(out);
}

export class DiscordWatcher extends EventEmitter {
  constructor({ rootDir }) {
    super();
    this.rootDir = rootDir;

    this.storageStatePath = path.join(this.rootDir, 'data', 'discord.storage.json');

    this.browser = null;
    this.context = null;
    this.page = null;

    this.running = false;
    this.headless = false;

    this.loggedIn = false;
    this.needsLogin = false;

    this.selectedGuildId = '';
    this.selectedChannelId = '';

    this._bindingInstalled = false;
    this._watching = false;
    this._seenMessageIds = new Set();
    this._recentMessages = [];
    this._lastError = '';

    this._bridgeFnName = '__marketmindDiscordNewMessage';
  }

  getStatus() {
    return {
      running: this.running,
      headless: this.headless,
      forcedHeadless: shouldForceHeadless() ? true : null,
      loggedIn: this.loggedIn,
      needsLogin: this.needsLogin,
      selected: {
        guildId: this.selectedGuildId || null,
        channelId: this.selectedChannelId || null
      },
      recentCount: this._recentMessages.length,
      lastError: this._lastError || null
    };
  }

  getRecentMessages() {
    return [...this._recentMessages];
  }

  clearRecentMessages() {
    this._recentMessages = [];
    this._seenMessageIds.clear();
  }

  async start({ headless = false } = {}) {
    if (this.running) {
      // If caller changes visibility preference, restart.
      if (Boolean(headless) !== Boolean(this.headless)) {
        await this.stop();
      } else {
        await this._refreshLoginState();
        return this.getStatus();
      }
    }

    this._lastError = '';
    const forceHeadless = shouldForceHeadless();
    this.headless = forceHeadless ? true : Boolean(headless);

    const hasStorage = fs.existsSync(this.storageStatePath);

    /** @type {import('playwright').LaunchOptions} */
    const launchOptions = { headless: this.headless };
    if (process.platform === 'linux') {
      launchOptions.chromiumSandbox = false;
      launchOptions.args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-software-rasterizer'
      ];
    }

    this.browser = await chromium.launch(launchOptions);
    this.context = await this.browser.newContext(hasStorage ? { storageState: this.storageStatePath } : {});
    this.page = await this.context.newPage();

    this.running = true;
    this._watching = false;
    this.selectedGuildId = '';
    this.selectedChannelId = '';

    this.page.on('close', () => {
      this.running = false;
      this.loggedIn = false;
      this.needsLogin = false;
      this._watching = false;
    });

    this.page.on('framenavigated', async () => {
      if (!this._watching) return;
      // Discord can reload/navigate during connection hiccups; re-inject observer.
      try {
        await this._installBindingIfNeeded();
        await this._installMessageObserver();
      } catch {
        // swallow; status polling will show error if persistent
      }
    });

    await this.page.goto('https://discord.com/channels/@me', { waitUntil: 'domcontentloaded' });

    // Discord is a heavy SPA; wait a bit for either login UI or app shell.
    await this.page
      .waitForFunction(
        () => {
          const hasLoginInputs = Boolean(
            document.querySelector(
              'input[name="email"], input[name="password"], input[autocomplete="username"], input[autocomplete="current-password"]'
            )
          );
          const hasGuildNavItems = Boolean(document.querySelector('[data-list-item-id^="guildsnav___"]'));
          const hasChannelsLinks = Boolean(document.querySelector('a[href^="/channels/"]'));
          return hasLoginInputs || hasGuildNavItems || hasChannelsLinks;
        },
        { timeout: 30_000 }
      )
      .catch(() => {});

    await this._refreshLoginState();

    // If logged in already, persist refreshed state.
    if (this.loggedIn) {
      await this._saveStorageState();
    }

    return this.getStatus();
  }

  async stop() {
    this._watching = false;
    this.selectedGuildId = '';
    this.selectedChannelId = '';
    this._bindingInstalled = false;

    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;

    this.running = false;
    this.loggedIn = false;
    this.needsLogin = false;

    if (browser) {
      await browser.close().catch(() => {});
    }

    return this.getStatus();
  }

  async resetAuth() {
    // Stop browser first to release any file locks.
    await this.stop();
    await fsp.unlink(this.storageStatePath).catch(() => {});
    return { ok: true };
  }

  async _saveStorageState() {
    if (!this.context) return;
    await fsp.mkdir(path.dirname(this.storageStatePath), { recursive: true });
    await this.context.storageState({ path: this.storageStatePath });
  }

  async _refreshLoginState() {
    if (!this.page) {
      this.loggedIn = false;
      this.needsLogin = false;
      return;
    }

    const url = this.page.url();
    const looksLikeLogin = url.includes('/login');

    if (looksLikeLogin) {
      this.loggedIn = false;
      this.needsLogin = true;
      return;
    }

    // Discord UI markup / aria-labels can vary by locale and change over time.
    // Use multiple weak signals instead of one strong selector.
    const signals = await this.page
      .evaluate(() => {
        const href = window.location.href;
        const onLoginRoute = href.includes('/login');

        // If a login form is visible, we are not logged in.
        const hasLoginForm = Boolean(
          document.querySelector(
            'input[name="email"], input[name="password"], input[autocomplete="username"], input[autocomplete="current-password"]'
          )
        );

        let token = '';
        try {
          token = String(window.localStorage.getItem('token') || '');
        } catch {
          token = '';
        }

        // token is usually a JSON string (quoted). Just check length.
        const hasToken = token.length > 20;

        const hasServersNav =
          Boolean(document.querySelector('nav[aria-label="Servers"]')) ||
          Boolean(document.querySelector('nav[aria-label*="Servers" i]'));

        const hasChannelsLinks = Boolean(document.querySelector('a[href^="/channels/"]'));

        // Discord often includes stable data-list-item-id markers for the guild rail.
        const hasGuildNavItems = Boolean(document.querySelector('[data-list-item-id^="guildsnav___"]'));

        return { onLoginRoute, hasLoginForm, hasToken, hasServersNav, hasChannelsLinks, hasGuildNavItems };
      })
      .catch(() => ({
        onLoginRoute: false,
        hasLoginForm: false,
        hasToken: false,
        hasServersNav: false,
        hasChannelsLinks: false,
        hasGuildNavItems: false
      }));

    if (signals.onLoginRoute || signals.hasLoginForm) {
      this.loggedIn = false;
      this.needsLogin = true;
      return;
    }

    const loggedIn = Boolean(
      signals.hasToken ||
        signals.hasGuildNavItems ||
        signals.hasServersNav ||
        signals.hasChannelsLinks
    );
    this.loggedIn = loggedIn;
    this.needsLogin = !loggedIn;
  }

  async waitForLogin({ timeoutMs = 10 * 60 * 1000 } = {}) {
    if (!this.page) throw new Error('Discord session not started');

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await this._refreshLoginState();
      if (this.loggedIn) {
        await this._saveStorageState();
        return this.getStatus();
      }
      await sleep(800);
    }

    throw new Error('Timed out waiting for Discord login');
  }

  async listGuilds() {
    if (!this.page) throw new Error('Discord session not started');
    await this._refreshLoginState();
    if (!this.loggedIn) throw new Error('Not logged in to Discord');

    // Best-effort DOM scrape. Discord UI changes frequently; avoid relying on a single nav selector.
    const guilds = await this.page.evaluate(() => {
      /** @type {Map<string, {id: string, name: string}>} */
      const byId = new Map();

      const cleanLabel = (value) => {
        let s = String(value || '').replace(/\s+/g, ' ').trim();
        s = s.replace(/^unread,\s*/i, '');
        s = s.replace(/\s*,\s*\d+\s+unread\s+messages?\s*$/i, '');
        return s;
      };

      const isSnowflake = (s) => /^\d{5,}$/.test(String(s || ''));

      const extractGuildIdFromHref = (href) => {
        try {
          const u = new URL(String(href || ''), window.location.origin);
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length >= 2 && parts[0] === 'channels') {
            return parts[1];
          }
          return '';
        } catch {
          return '';
        }
      };

      // 1) Primary: guild list items usually have data-list-item-id like "guildsnav___<guildId>".
      const guildItems = Array.from(document.querySelectorAll('[data-list-item-id^="guildsnav___"]'));
      for (const el of guildItems) {
        const raw = el.getAttribute('data-list-item-id') || '';
        const guildId = raw.replace('guildsnav___', '');
        if (!isSnowflake(guildId)) continue;

        const name =
          el.getAttribute('aria-label') ||
          el.querySelector('[aria-label]')?.getAttribute('aria-label') ||
          el.getAttribute('data-dnd-name') ||
          el.textContent?.trim() ||
          guildId;

        if (!byId.has(guildId)) {
          byId.set(guildId, { id: guildId, name: cleanLabel(name) || guildId });
        }
      }

      // 2) Fallback: scrape any /channels/<guildId>/ links anywhere (relative or absolute).
      const anchors = Array.from(document.querySelectorAll('a[href*="/channels/"]'));
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const guildId = extractGuildIdFromHref(href);
        if (!isSnowflake(guildId)) continue;
        if (byId.has(guildId)) continue;

        const name =
          a.getAttribute('aria-label') ||
          a.getAttribute('data-dnd-name') ||
          a.textContent?.trim() ||
          guildId;
        byId.set(guildId, { id: guildId, name: cleanLabel(name) || guildId });
      }

      return Array.from(byId.values());
    });

    return Array.isArray(guilds) ? guilds : [];
  }

  async debugDom() {
    if (!this.page) throw new Error('Discord session not started');
    await this._refreshLoginState();
    const info = await this.page
      .evaluate(() => {
        const re = /https?:\/\/[^\s<>()\[\]{}"']+/gi;

        const els = Array.from(document.querySelectorAll('[data-list-item-id]'));
        const listItemIds = els.map((e) => e.getAttribute('data-list-item-id')).filter(Boolean);
        const guildNavIds = listItemIds.filter((x) => String(x).startsWith('guildsnav___'));
        const channelAnchors = Array.from(document.querySelectorAll('a[href^="/channels/"]'))
          .map((a) => a.getAttribute('href'))
          .filter(Boolean);
        const loginInputs = Array.from(
          document.querySelectorAll(
            'input[name="email"], input[name="password"], input[autocomplete="username"], input[autocomplete="current-password"]'
          )
        ).length;

        const chatEls = Array.from(document.querySelectorAll('[id^="chat-messages-"]')).slice(0, 20);
        const chatSamples = chatEls.map((el) => {
          const id = el.getAttribute('id') || '';
          const contentEl = el.querySelector('[id^="message-content-"]');
          const contentText = (contentEl?.textContent || '').trim().slice(0, 160);

          const anchors = Array.from(el.querySelectorAll('a'));
          const hrefs = anchors
            .map((a) => a.getAttribute('href') || a.href || '')
            .filter(Boolean)
            .slice(0, 10);

          const titles = anchors
            .map((a) => a.getAttribute('title') || '')
            .filter(Boolean)
            .slice(0, 10);

          const titledEls = Array.from(el.querySelectorAll('[title]'));
          const titledUrls = [];
          for (const t of titledEls) {
            const title = t.getAttribute('title') || '';
            if (!title) continue;
            let m;
            while ((m = re.exec(title))) {
              titledUrls.push(m[0]);
              if (titledUrls.length >= 10) break;
            }
            if (titledUrls.length >= 10) break;
          }

          return {
            id,
            contentText,
            counts: {
              anchors: anchors.length,
              anchorsWithHrefAttr: anchors.filter((a) => a.hasAttribute('href')).length,
              titledEls: titledEls.length
            },
            samples: { hrefs, titles, titledUrls }
          };
        });

        const anyChat = {
          count: document.querySelectorAll('[id^="chat-messages-"]').length,
          firstWithAnchors: chatSamples.find((x) => (x.counts?.anchors || 0) > 0) || null,
          firstWithHrefAttr: chatSamples.find((x) => (x.counts?.anchorsWithHrefAttr || 0) > 0) || null,
          firstWithTitledUrl: chatSamples.find((x) => (x.samples?.titledUrls || []).length > 0) || null
        };

        return {
          url: window.location.href,
          counts: {
            dataListItemId: listItemIds.length,
            guildsnav: guildNavIds.length,
            channelsLinks: channelAnchors.length,
            loginInputs,
            chatMessages: anyChat.count
          },
          samples: {
            guildsnav: guildNavIds.slice(0, 20),
            channelsLinks: channelAnchors.slice(0, 20),
            chat: anyChat
          }
        };
      })
      .catch((e) => ({ url: this.page?.url?.() || '', counts: {}, samples: {}, error: e instanceof Error ? e.message : String(e) }));

    return { status: this.getStatus(), dom: info };
  }

  async listTextChannels({ guildId }) {
    if (typeof guildId !== 'string' || !guildId.trim()) throw new Error('guildId is required');
    if (!this.page) throw new Error('Discord session not started');
    await this._refreshLoginState();
    if (!this.loggedIn) throw new Error('Not logged in to Discord');

    // Navigate to the guild; Discord will redirect to last channel.
    await this.page.goto(`https://discord.com/channels/${encodeURIComponent(guildId)}`, { waitUntil: 'domcontentloaded' });

    // Wait for *some* channel link to show up.
    await this.page.locator(`a[href*="/channels/${guildId}/"]`).first().waitFor({ timeout: 30_000 });

    const channels = await this.page.evaluate((gid) => {
      const isSnowflake = (s) => /^\d{5,}$/.test(String(s || ''));

      const cleanLabel = (value) => {
        let s = String(value || '').replace(/\s+/g, ' ').trim();
        s = s.replace(/^unread,\s*/i, '');
        s = s.replace(/\s*\((text|announcement)\s+channel\)\s*$/i, '');
        return s;
      };

      const extractChannelIdFromHref = (href) => {
        try {
          const u = new URL(String(href || ''), window.location.origin);
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length >= 3 && parts[0] === 'channels' && parts[1] === gid) {
            return parts[2];
          }
          return '';
        } catch {
          return '';
        }
      };

      /** @type {Map<string, {id: string, name: string}>} */
      const byId = new Map();

      const anchors = Array.from(document.querySelectorAll(`a[href*="/channels/${gid}/"]`));
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const channelId = extractChannelIdFromHref(href);
        if (!isSnowflake(channelId)) continue;
        if (byId.has(channelId)) continue;

        const rawText = cleanLabel(a.textContent || '');
        const label = cleanLabel(a.getAttribute('aria-label') || rawText);
        const normalized = cleanLabel(String(label || '').replace(/^#\s*/, ''));
        if (!normalized) continue;

        // Best-effort filter for text channels: keep channels that look like "#name" or have readable text.
        // If Discord changes markup, this may include some non-text channels, but it will at least populate.
        byId.set(channelId, { id: channelId, name: normalized });
      }

      return Array.from(byId.values());
    }, guildId);

    return Array.isArray(channels) ? channels : [];
  }

  async selectChannel({ guildId, channelId }) {
    if (typeof guildId !== 'string' || !guildId.trim()) throw new Error('guildId is required');
    if (typeof channelId !== 'string' || !channelId.trim()) throw new Error('channelId is required');
    if (!this.page) throw new Error('Discord session not started');
    await this._refreshLoginState();
    if (!this.loggedIn) throw new Error('Not logged in to Discord');

    this._lastError = '';
    this.selectedGuildId = guildId;
    this.selectedChannelId = channelId;

    this.clearRecentMessages();

    const url = `https://discord.com/channels/${encodeURIComponent(guildId)}/${encodeURIComponent(channelId)}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });

    await this._installBindingIfNeeded();
    await this._installMessageObserver();

    this._watching = true;

    return this.getStatus();
  }

  async fetchToday({ maxScrolls = 40, maxMessages = 4000 } = {}) {
    if (!this.page) throw new Error('Discord session not started');
    await this._refreshLoginState();
    if (!this.loggedIn) throw new Error('Not logged in to Discord');
    if (!this.selectedGuildId || !this.selectedChannelId) throw new Error('No channel selected');

    const scrollLimit = Number.isFinite(maxScrolls) ? Math.min(Math.max(Math.trunc(maxScrolls), 1), 200) : 40;
    const messageLimit = Number.isFinite(maxMessages) ? Math.min(Math.max(Math.trunc(maxMessages), 100), 20_000) : 4000;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const startMs = startOfToday.getTime();
    const endMs = startOfTomorrow.getTime();

    const wasWatching = this._watching;
    this._watching = false;

    try {
      // Ensure we're on the selected channel URL.
      const expected = `/channels/${this.selectedGuildId}/${this.selectedChannelId}`;
      if (!this.page.url().includes(expected)) {
        await this.page.goto(`https://discord.com${expected}`, { waitUntil: 'domcontentloaded' });
      }

      // Wait for the message list to render at least one item.
      await this.page.locator('[id^="chat-messages-"]').first().waitFor({ timeout: 15_000 }).catch(() => {});

      // Disable the live observer while we scroll to avoid streaming history as "new".
      await this.page.evaluate(() => {
        const w = window;
        if (w.__mmDiscordObserver && typeof w.__mmDiscordObserver.disconnect === 'function') {
          try {
            w.__mmDiscordObserver.disconnect();
          } catch {
            // ignore
          }
        }
        w.__mmDiscordObserver = null;
      });

      /** @type {Map<string, {messageId:string, author:string, content:string, timestamp:string, guildId:string, channelId:string}>} */
      const byId = new Map();
      let oldestSeenMs = Number.POSITIVE_INFINITY;

      for (let i = 0; i < scrollLimit; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const snap = await this.page.evaluate(() => {
          function parseIdsFromLocation() {
            const parts = window.location.pathname.split('/').filter(Boolean);
            if (parts.length >= 3 && parts[0] === 'channels') {
              return { guildId: parts[1], channelId: parts[2] };
            }
            return { guildId: '', channelId: '' };
          }

          function extractMessage(el) {
            if (!el || !(el instanceof Element)) return null;
            const id = el.getAttribute('id') || '';
            if (!id.startsWith('chat-messages-')) return null;
            const messageId = id.replace('chat-messages-', '');
            if (!messageId) return null;

            const contentEl = el.querySelector('[id^="message-content-"]');
            const content = contentEl ? (contentEl.textContent || '').trim() : '';

            const links = (() => {
              const set = new Set();
              const re = /https?:\/\/[^\s<>()\[\]{}"']+/gi;

              const pushUrl = (u) => {
                const raw = String(u || '');
                if (!raw) return;
                const trimmed = raw.replace(/[\]\)}>,.;:!?]+$/g, '');
                if (trimmed && /^https?:\/\//i.test(trimmed)) set.add(trimmed);
              };

              // Primary: anchors (Discord may not expose href as an attribute, so read the property).
              const anchors = Array.from(el.querySelectorAll('a'));
              for (const a of anchors) {
                pushUrl(a.href);
                const title = a.getAttribute('title') || '';
                let m;
                while ((m = re.exec(title))) pushUrl(m[0]);
              }

              // Fallback: any title attribute within the message.
              const titled = Array.from(el.querySelectorAll('[title]'));
              for (const t of titled) {
                const title = t.getAttribute('title') || '';
                let m;
                while ((m = re.exec(title))) pushUrl(m[0]);
              }

              return Array.from(set.values()).slice(0, 25).map((href) => ({ href, text: '' }));
            })();

            if (!content && !links.length) return null;

            const author =
              el.querySelector('h3 span[class*="username" i]')?.textContent?.trim() ||
              el.querySelector('h3')?.textContent?.trim() ||
              '';

            const ts = el.querySelector('time')?.getAttribute('datetime') || '';
            const { guildId, channelId } = parseIdsFromLocation();

            return {
              messageId,
              author,
              content,
              timestamp: ts,
              guildId,
              channelId,
              links
            };
          }

          const els = Array.from(document.querySelectorAll('[id^="chat-messages-"]'));
          const msgs = [];

          let oldestTs = null;
          for (const el of els) {
            const msg = extractMessage(el);
            if (msg) msgs.push(msg);
            const dt = el.querySelector('time')?.getAttribute('datetime') || '';
            const ms = dt ? Date.parse(dt) : NaN;
            if (Number.isFinite(ms)) {
              oldestTs = oldestTs === null ? ms : Math.min(oldestTs, ms);
            }
          }

          // Scroll up: find the nearest scrollable container for the message list.
          let scroller = null;
          const seed = els[0] || null;
          let cur = seed;
          while (cur && cur.parentElement) {
            const el = cur instanceof HTMLElement ? cur : null;
            if (el) {
              const style = window.getComputedStyle(el);
              const oy = style.overflowY;
              if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 80) {
                scroller = el;
                break;
              }
            }
            cur = cur.parentElement;
          }

          let scrolled = false;
          if (scroller) {
            const before = scroller.scrollTop;
            scroller.scrollTop = 0;
            scrolled = before > 0;
          }

          return { msgs, oldestTs, scrolled, visibleCount: els.length };
        });

        for (const m of snap?.msgs || []) {
          if (m && typeof m.messageId === 'string' && m.messageId && !byId.has(m.messageId)) {
            byId.set(m.messageId, m);
          }
        }

        if (typeof snap?.oldestTs === 'number' && Number.isFinite(snap.oldestTs)) {
          oldestSeenMs = Math.min(oldestSeenMs, snap.oldestTs);
        }

        if (byId.size >= messageLimit) break;
        if (!snap?.scrolled) break;
        if (Number.isFinite(oldestSeenMs) && oldestSeenMs < startMs) break;

        // eslint-disable-next-line no-await-in-loop
        await this.page.waitForTimeout(900);
      }

      const all = Array.from(byId.values());
      const todays = all
        .map((m) => {
          const ts = typeof m.timestamp === 'string' ? m.timestamp : '';
          const ms = ts ? Date.parse(ts) : NaN;
          return { ...m, _ms: ms };
        })
        .filter((m) => Number.isFinite(m._ms) && m._ms >= startMs && m._ms < endMs)
        .sort((a, b) => b._ms - a._ms)
        .map(({ _ms, ...rest }) => rest);

      return { ok: true, date: startOfToday.toISOString().slice(0, 10), count: todays.length, messages: todays };
    } finally {
      if (wasWatching) {
        // Resume live watching from current DOM state.
        try {
          await this._installBindingIfNeeded();
          await this._installMessageObserver();
        } catch {
          // best-effort
        }
        this._watching = true;
      }
    }
  }

  async _installBindingIfNeeded() {
    if (!this.page) return;

    const fnName = this._bridgeFnName;

    // Even if we previously marked it installed, Discord navigations can sometimes drop/replace globals.
    const present = await this.page
      .evaluate((name) => typeof window[name] === 'function', fnName)
      .catch(() => false);
    if (present) {
      this._bindingInstalled = true;
      return;
    }

    // Expose a global function into the page that we can call from the MutationObserver.
    // Using exposeFunction here has been more reliable than exposeBinding for Discord.

    try {
      await this.page.exposeFunction(fnName, (payload) => {
        this._handleNewMessage(payload);
      });
    } catch {
      // If Playwright already registered the function name, it can throw here.
      // We'll rely on the presence check below.
    }

    const ok = await this.page
      .evaluate((name) => typeof window[name] === 'function', fnName)
      .catch(() => false);
    if (!ok) throw new Error('Failed to install Discord message bridge');

    this._bindingInstalled = true;
  }

  _handleNewMessage(payload) {
    try {
      if (!payload || typeof payload !== 'object') return;
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
      if (!messageId) return;
      if (this._seenMessageIds.has(messageId)) return;
      this._seenMessageIds.add(messageId);

      const linksRaw = Array.isArray(payload.links) ? payload.links : [];
      const links = linksRaw
        .map((l) => {
          if (!l || typeof l !== 'object') return null;
          const href = typeof l.href === 'string' ? l.href : '';
          const text = typeof l.text === 'string' ? l.text : '';
          if (!href || !/^https?:\/\//i.test(href)) return null;
          return { href, text };
        })
        .filter(Boolean);

      const msg = {
        messageId,
        author: typeof payload.author === 'string' ? payload.author : '',
        content: typeof payload.content === 'string' ? payload.content : '',
        timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString(),
        guildId: typeof payload.guildId === 'string' ? payload.guildId : this.selectedGuildId,
        channelId: typeof payload.channelId === 'string' ? payload.channelId : this.selectedChannelId,
        links
      };

      if (!msg.content.trim()) return;

      this._recentMessages.push(msg);
      if (this._recentMessages.length > 500) {
        this._recentMessages = this._recentMessages.slice(this._recentMessages.length - 500);
      }

      this.emit('message', msg);
    } catch {
      // no logs
    }
  }

  async _installMessageObserver() {
    if (!this.page) return;

    const fnName = this._bridgeFnName;

    // Install (or refresh) an in-page MutationObserver that emits only NEW messages.
    await this.page.evaluate((bridgeName) => {
      const w = window;
      // Clean up any existing observer.
      if (w.__mmDiscordObserver && typeof w.__mmDiscordObserver.disconnect === 'function') {
        try {
          w.__mmDiscordObserver.disconnect();
        } catch {
          // ignore
        }
      }

      const send = w[bridgeName];
      if (typeof send !== 'function') {
        throw new Error('Discord message bridge not installed');
      }

      const seen = new Set();

      function parseIdsFromLocation() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        // channels/<guildId>/<channelId>
        if (parts.length >= 3 && parts[0] === 'channels') {
          return { guildId: parts[1], channelId: parts[2] };
        }
        return { guildId: '', channelId: '' };
      }

      function extractMessage(el) {
        if (!el || !(el instanceof Element)) return null;
        const id = el.getAttribute('id') || '';
        if (!id.startsWith('chat-messages-')) return null;
        const messageId = id.replace('chat-messages-', '');
        if (!messageId) return null;

        const contentEl = el.querySelector('[id^="message-content-"]');

        const links = (() => {
          const set = new Set();
          const re = /https?:\/\/[^\s<>()\[\]{}"']+/gi;

          const pushUrl = (u) => {
            const raw = String(u || '');
            if (!raw) return;
            const trimmed = raw.replace(/[\]\)}>,.;:!?]+$/g, '');
            if (trimmed && /^https?:\/\//i.test(trimmed)) set.add(trimmed);
          };

          const anchors = Array.from(el.querySelectorAll('a'));
          for (const a of anchors) {
            pushUrl(a.href);
            const title = a.getAttribute('title') || '';
            let m;
            while ((m = re.exec(title))) pushUrl(m[0]);
          }

          const titled = Array.from(el.querySelectorAll('[title]'));
          for (const t of titled) {
            const title = t.getAttribute('title') || '';
            let m;
            while ((m = re.exec(title))) pushUrl(m[0]);
          }

          return Array.from(set.values()).slice(0, 25).map((href) => ({ href, text: '' }));
        })();

        const content = contentEl ? (contentEl.textContent || '').trim() : '';

        // Try a few likely header patterns; Discord markup changes often.
        const author =
          el.querySelector('h3 span[class*="username" i]')?.textContent?.trim() ||
          el.querySelector('h3')?.textContent?.trim() ||
          '';

        const ts = el.querySelector('time')?.getAttribute('datetime') || new Date().toISOString();
        const { guildId, channelId } = parseIdsFromLocation();

        if (!content && !links.length) return null;
        return { messageId, author, content, timestamp: ts, guildId, channelId, links };
      }

      function seedSeen() {
        const existing = Array.from(document.querySelectorAll('[id^="chat-messages-"]'));
        for (const el of existing) {
          const id = el.getAttribute('id') || '';
          if (id.startsWith('chat-messages-')) {
            const messageId = id.replace('chat-messages-', '');
            if (messageId) seen.add(messageId);
          }
        }
      }

      function scanNode(node) {
        if (!node) return;
        /** @type {Element[]} */
        const candidates = [];
        if (node instanceof Element) {
          if ((node.getAttribute('id') || '').startsWith('chat-messages-')) {
            candidates.push(node);
          }
          candidates.push(...Array.from(node.querySelectorAll?.('[id^="chat-messages-"]') || []));
        }

        for (const el of candidates) {
          const id = el.getAttribute('id') || '';
          if (!id.startsWith('chat-messages-')) continue;
          const messageId = id.replace('chat-messages-', '');
          if (!messageId || seen.has(messageId)) continue;

          const msg = extractMessage(el);
          seen.add(messageId);
          if (msg) {
            try {
              send(msg);
            } catch {
              // ignore
            }
          }
        }
      }

      seedSeen();

      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of m.addedNodes || []) {
            scanNode(n);
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      w.__mmDiscordObserver = observer;
    }, fnName);
  }
}

export function createDiscordWatcher({ rootDir }) {
  return new DiscordWatcher({ rootDir });
}

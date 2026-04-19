/**
 * مراقبة زيارة الصفحة → Discord Webhook
 * ملاحظة: المتصفح لا يعطي نفس رؤوس HTTP الخام؛ نرسل بدلها بيانات مشتقة (User-Agent، الصفحة، الشاشة، إلخ).
 * الـ IP يُستخرج عبر خدمة عامة (يمكن تغييرها).
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    webhookUrl:
      'https://discord.com/api/webhooks/1495259962060968108/VyY2NtOEK20itTZg7X5kayb1m6laU4T0MUtBb8KmxuZT9uxDvpFRjE1XDUpQhccqcOeW',
    /** خدمة IP عامة — استبدلها بـ endpoint خادمك إن أردت دقة أعلى */
    ipLookupUrl: 'https://api.ipify.org?format=json',
    /** انتظر اكتمال التخطيط قبل اللقطة */
    captureDelayMs: 400,
    /** حد أقصى لارتفاع اللقطة (أداء/حجم) */
    maxCanvasHeight: 4000,
  };

  function buildClientRequestHeaders(nav) {
    const h = {
      Host: location.host,
      'User-Agent': nav.userAgent,
      'Accept-Language': nav.language,
      Referer: document.referrer || undefined,
      DNT: nav.doNotTrack != null ? String(nav.doNotTrack) : undefined,
      'Sec-CH-UA': nav.userAgentData ? JSON.stringify(nav.userAgentData.brands || []) : undefined,
      'Sec-CH-UA-Mobile': nav.userAgentData ? String(!!nav.userAgentData.mobile) : undefined,
      'Sec-CH-UA-Platform': nav.userAgentData ? nav.userAgentData.platform : undefined,
    };
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn) {
      if (conn.effectiveType) h['Network-Client-Hint'] = 'effectiveType=' + conn.effectiveType;
      if (conn.downlink != null) h['Estimated-Downlink-Mbps'] = String(conn.downlink);
    }
    return h;
  }

  function collectClientSnapshot() {
    const nav = navigator;
    const scr = screen;
    return {
      collectedAt: new Date().toISOString(),
      page: {
        href: location.href,
        origin: location.origin,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        title: document.title || null,
        referrer: document.referrer || null,
      },
      /** ما يمكن تمثيله من «الطلب» في المتصفح (ليس نسخة الخادم الخام) */
      requestLike: {
        method: 'GET',
        httpVersion: 'HTTP/1.1 (browser context)',
        url: location.href,
        path: location.pathname + location.search + location.hash,
        headers: buildClientRequestHeaders(nav),
      },
      navigator: {
        userAgent: nav.userAgent,
        language: nav.language,
        languages: nav.languages ? Array.from(nav.languages) : [],
        platform: nav.platform,
        cookieEnabled: nav.cookieEnabled,
        onLine: nav.onLine,
        hardwareConcurrency: nav.hardwareConcurrency,
        deviceMemory: nav.deviceMemory,
      },
      display: {
        screen: scr ? { width: scr.width, height: scr.height, availWidth: scr.availWidth, availHeight: scr.availHeight, colorDepth: scr.colorDepth, pixelDepth: scr.pixelDepth } : null,
        viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };
  }

  async function fetchPublicIp(ipLookupUrl) {
    try {
      const res = await fetch(ipLookupUrl, { cache: 'no-store' });
      const data = await res.json();
      if (data && data.ip) return data.ip;
    } catch (_) {}
    return null;
  }

  function loadHtml2Canvas() {
    return new Promise(function (resolve, reject) {
      if (global.html2canvas) {
        resolve(global.html2canvas);
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.async = true;
      s.onload = function () {
        if (global.html2canvas) resolve(global.html2canvas);
        else reject(new Error('html2canvas not loaded'));
      };
      s.onerror = function () {
        reject(new Error('Failed to load html2canvas'));
      };
      document.head.appendChild(s);
    });
  }

  function capturePagePng(html2canvas, opts) {
    const target = document.documentElement;
    return html2canvas(target, {
      useCORS: true,
      allowTaint: false,
      logging: false,
      scale: Math.min(1, (opts.maxCanvasHeight || 4000) / Math.max(target.scrollHeight, 1)),
      windowHeight: target.scrollHeight,
      windowWidth: target.scrollWidth,
    }).then(function (canvas) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) reject(new Error('toBlob failed'));
          else resolve(blob);
        }, 'image/png');
      });
    });
  }

  /** وصف الـ embed في Discord بحد أقصى 4096 حرفًا */
  function formatRequestForDiscord(snapshot) {
    var maxLen = 4096;
    var head = '```json\n';
    var tail = '\n```';
    var budget = maxLen - head.length - tail.length;
    var inner = JSON.stringify(snapshot, null, 2);
    if (inner.length > budget) {
      inner = JSON.stringify(snapshot);
    }
    if (inner.length > budget) {
      inner = inner.slice(0, Math.max(0, budget - 24)) + '…(مختصر)';
    }
    return head + inner + tail;
  }

  /**
   * @param {object} options
   * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
   */
  async function sendToDiscord(options) {
    const opts = Object.assign({}, DEFAULTS, options);
    if (!opts.webhookUrl || typeof opts.webhookUrl !== 'string') {
      throw new Error('visitor-monitor: webhookUrl مطلوب');
    }

    const snapshot = collectClientSnapshot();
    const ip = await fetchPublicIp(opts.ipLookupUrl);
    snapshot.visitor = { publicIp: ip };

    await new Promise(function (r) {
      return setTimeout(r, opts.captureDelayMs);
    });

    let pngBlob = null;
    try {
      const html2canvas = await loadHtml2Canvas();
      pngBlob = await capturePagePng(html2canvas, opts);
    } catch (e) {
      snapshot.capture = { screenshot: 'failed', reason: String(e && e.message ? e.message : e) };
    }

    if (pngBlob) {
      snapshot.capture = { screenshot: 'ok' };
    }

    const requestBodyText = formatRequestForDiscord(snapshot);
    const embed = {
      title: 'زيارة — الطلب والسياق',
      description: requestBodyText,
      color: 0x5865f2,
      timestamp: new Date().toISOString(),
    };

    const payload = {
      embeds: [embed],
      allowed_mentions: { parse: [] },
    };

    const url = opts.webhookUrl + (opts.webhookUrl.indexOf('?') >= 0 ? '&' : '?') + 'wait=true';

    let res;
    if (pngBlob) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      form.append('files[0]', pngBlob, 'page-screenshot.png');
      res = await fetch(url, { method: 'POST', body: form });
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) {
      const t = await res.text().catch(function () {
        return '';
      });
      throw new Error('Discord HTTP ' + res.status + ' ' + t);
    }
    return { ok: true, status: res.status };
  }

  global.initVisitorMonitor = sendToDiscord;
})(typeof window !== 'undefined' ? window : this);

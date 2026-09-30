/*!
 * VDC Tracker v1.0.2
 * First-party tracking SDK for Vision Dental Clinic (VDC).
 *
 * Runs on the website, the landing pages, and Chattop (web).
 * Sends events to the VDC data center endpoint. It is independent of
 * Meta Pixel / GA4 / Google Ads tags and does not replace them.
 *
 * PRIVACY RULES BUILT IN
 *  - Never reads form field values. Never sends names, phones, emails or clinical data.
 *  - Sends page URLs WITHOUT the query string (so nothing personal can leak through a URL).
 *  - Custom event properties whose key looks personal or clinical are dropped.
 *
 * SETUP (in <head>, before or as the script tag itself):
 *   <script src="/vdc-tracker.js" defer
 *           data-endpoint="https://DATA-DOMAIN/api/events"
 *           data-env="staging"></script>
 *   Or set window.VDC_CONFIG = {...} before loading the script.
 *
 * CONFIG KEYS (window.VDC_CONFIG or data-* attributes on the script tag)
 *   endpoint         Collection URL. If empty, nothing is sent (safe for early testing).
 *   env              "staging" | "production". Auto: staging on localhost / *.github.io / *.pages.dev, else production.
 *   debug            true = log every event to the console and keep them in VDC.debugLog.
 *   requireConsent   true = no storage and no sending until VDC.setConsent(true). (Legal decision pending.)
 *   spa              true = also send page_view on history changes (single-page apps such as Chattop).
 *   handoffHosts     Hostnames of links that receive vdc_vid / vdc_ref. Default ["chattop.mysmyle.net"].
 *   ownHosts         Extra hostnames treated as "our own site" (internal navigation, not a referral).
 *   sessionMinutes   Inactivity minutes before a new session. Default 30.
 *   autoPageView     false = do not send page_view automatically.
 */
(function (window, document) {
  'use strict';
  if (window.VDC && window.VDC.__loaded) { return; }

  var VERSION = '1.0.2';
  var script = document.currentScript;
  var userCfg = window.VDC_CONFIG || {};

  function scriptAttr(name) {
    return script && script.getAttribute ? script.getAttribute('data-' + name) : null;
  }
  function pick(key, attrName, fallback) {
    if (userCfg[key] !== undefined && userCfg[key] !== null) { return userCfg[key]; }
    var a = scriptAttr(attrName);
    if (a !== null && a !== undefined && a !== '') { return a; }
    return fallback;
  }
  function asBool(v) { return v === true || v === 'true' || v === '1'; }

  var host = (location.hostname || '').toLowerCase();
  var autoEnv = (host === 'localhost' || host === '127.0.0.1' || /\.github\.io$/.test(host) ||
                 /\.pages\.dev$/.test(host) || /\.netlify\.app$/.test(host)) ? 'staging' : 'production';

  var cfg = {
    endpoint: String(pick('endpoint', 'endpoint', '')),
    env: String(pick('env', 'env', autoEnv)),
    debug: asBool(pick('debug', 'debug', false)),
    requireConsent: asBool(pick('requireConsent', 'require-consent', false)),
    spa: asBool(pick('spa', 'spa', false)),
    handoffHosts: userCfg.handoffHosts || ['chattop.mysmyle.net'],
    ownHosts: userCfg.ownHosts || [],
    sessionMinutes: Number(pick('sessionMinutes', 'session-minutes', 30)) || 30,
    autoPageView: !(userCfg.autoPageView === false || scriptAttr('auto-page-view') === 'false')
  };

  var debugLog = [];
  function log() {
    if (!cfg.debug || !window.console) { return; }
    var args = ['[VDC]'].concat(Array.prototype.slice.call(arguments));
    try { console.log.apply(console, args); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- utils
  function nowMs() { return new Date().getTime(); }
  function rndHex(bytes) {
    var out = '', i, arr;
    try {
      arr = new Uint8Array(bytes);
      window.crypto.getRandomValues(arr);
      for (i = 0; i < bytes; i++) { out += ('0' + arr[i].toString(16)).slice(-2); }
      return out;
    } catch (e) {
      out = '';
      for (i = 0; i < bytes; i++) { out += ('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2); }
      return out;
    }
  }
  function newId(prefix) { return prefix + '_' + rndHex(16); }
  var VID_RE = /^v_[a-f0-9]{32}$/;
  var SID_RE = /^s_[a-f0-9]{32}$/;

  function clip(v, n) { v = String(v == null ? '' : v); return v.length > n ? v.slice(0, n) : v; }
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  function parseQuery() {
    var out = {};
    var q = (location.search || '').replace(/^\?/, '');
    if (!q) { return out; }
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) { continue; }
      var idx = parts[i].indexOf('=');
      var k = safeDecode(idx < 0 ? parts[i] : parts[i].slice(0, idx)).toLowerCase();
      var v = idx < 0 ? '' : safeDecode(parts[i].slice(idx + 1).replace(/\+/g, ' '));
      out[k] = v;
    }
    return out;
  }

  function hostIn(list, h) {
    h = (h || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var x = String(list[i]).toLowerCase();
      if (h === x || h === 'www.' + x || x === 'www.' + h) { return true; }
    }
    return false;
  }
  function isOwnHost(h) {
    return h === host || h === 'www.' + host || 'www.' + h === host || hostIn(cfg.ownHosts, h);
  }

  // ------------------------------------------------------------- consent + storage
  var mem = {};
  var consent = 'granted';
  var KEYS = ['vdc_vid', 'vdc_sess', 'vdc_ft'];

  function rawGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function rawSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function rawDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  if (cfg.requireConsent) {
    var storedConsent = rawGet('vdc_consent');
    consent = storedConsent === 'granted' || storedConsent === 'denied' ? storedConsent : 'pending';
  }
  function canPersist() { return consent === 'granted'; }
  function sget(k) {
    if (!canPersist()) { return mem.hasOwnProperty(k) ? mem[k] : null; }
    var v = rawGet(k);
    return v === null && mem.hasOwnProperty(k) ? mem[k] : v;
  }
  function sset(k, v) {
    mem[k] = v;
    if (canPersist()) { rawSet(k, v); }
  }
  function readJSON(k) { try { return JSON.parse(sget(k)); } catch (e) { return null; } }
  function writeJSON(k, o) { sset(k, JSON.stringify(o)); }

  // ------------------------------------------------------------- attribution
  var CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'oppref'];
  // Meta dynamic URL parameters (set in the ad's URL parameters with {{campaign.id}} etc.)
  var PLATFORM_PARAMS = ['meta_campaign_id', 'meta_adset_id', 'meta_ad_id', 'meta_placement', 'meta_site_source'];

  // AI answer engines. Organic visits from these are labelled medium "organic_ai".
  // Paid ChatGPT ads are labelled medium "paid_ai" (utm_medium=paid_ai or the oppref click id).
  var AI_ENGINES = [
    { id: 'chatgpt',    hosts: ['chatgpt.com', 'chat.openai.com', 'openai.com'] },
    { id: 'claude',     hosts: ['claude.ai'] },
    { id: 'gemini',     hosts: ['gemini.google.com', 'bard.google.com'] },
    { id: 'perplexity', hosts: ['perplexity.ai'] },
    { id: 'copilot',    hosts: ['copilot.microsoft.com'] },
    { id: 'deepseek',   hosts: ['deepseek.com', 'chat.deepseek.com'] },
    { id: 'grok',       hosts: ['grok.com', 'x.ai'] },
    { id: 'you',        hosts: ['you.com'] },
    { id: 'poe',        hosts: ['poe.com'] },
    { id: 'phind',      hosts: ['phind.com'] },
    { id: 'meta_ai',    hosts: ['meta.ai'] }
  ];
  function hostMatches(h, base) { return h === base || h.slice(-(base.length + 1)) === '.' + base; }
  function aiEngineForHost(h) {
    h = (h || '').toLowerCase();
    for (var i = 0; i < AI_ENGINES.length; i++) {
      for (var j = 0; j < AI_ENGINES[i].hosts.length; j++) {
        if (hostMatches(h, AI_ENGINES[i].hosts[j])) { return AI_ENGINES[i].id; }
      }
    }
    return '';
  }
  // utm_source values that AI products add themselves, e.g. "chatgpt.com"
  function aiEngineForUtmSource(v) {
    v = (v || '').toLowerCase().trim();
    if (!v) { return ''; }
    var e = aiEngineForHost(v);
    if (e) { return e; }
    for (var i = 0; i < AI_ENGINES.length; i++) { if (AI_ENGINES[i].id === v) { return v; } }
    return '';
  }

  function classifyReferrer() {
    var ref = document.referrer;
    if (!ref) { return { source: 'direct', medium: 'none' }; }
    var u;
    try { u = new URL(ref); } catch (e) { return { source: 'direct', medium: 'none' }; }
    var h = u.hostname.toLowerCase();
    if (isOwnHost(h)) { return null; }
    var aiRef = aiEngineForHost(h);
    if (aiRef) { return { source: aiRef, medium: 'organic_ai' }; }
    if (/(^|\.)google\.[a-z.]+$/.test(h)) {
      if (h.indexOf('maps.') === 0 || u.pathname.indexOf('/maps') === 0) { return { source: 'google_maps', medium: 'organic' }; }
      return { source: 'google', medium: 'organic' };
    }
    if (/(^|\.)bing\.com$/.test(h)) { return { source: 'bing', medium: 'organic' }; }
    if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(h)) { return { source: 'facebook', medium: 'organic' }; }
    if (/(^|\.)instagram\.com$/.test(h)) { return { source: 'instagram', medium: 'organic' }; }
    return { source: clip(h, 100), medium: 'referral' };
  }

  function detectTouch(q, hasHandoff) {
    var t = { source: '', medium: '', campaign: '', content: '', term: '', explicit: false, click_ids: {}, platform_ids: {} };
    var hasUtm = !!(q.utm_source || q.utm_medium || q.utm_campaign);
    var i, id;
    for (i = 0; i < CLICK_IDS.length; i++) {
      id = CLICK_IDS[i];
      if (q[id]) { t.click_ids[id] = clip(q[id], 200); }
    }
    var hasClick = false;
    for (id in t.click_ids) { if (t.click_ids.hasOwnProperty(id)) { hasClick = true; } }
    var hasPlatform = false;
    for (i = 0; i < PLATFORM_PARAMS.length; i++) {
      id = PLATFORM_PARAMS[i];
      if (q[id]) { t.platform_ids[id] = clip(q[id], 100); hasPlatform = true; }
    }

    if (hasUtm || hasClick || hasPlatform) {
      t.explicit = true;
      t.source = clip((q.utm_source || '').toLowerCase().trim(), 100);
      t.medium = clip((q.utm_medium || '').toLowerCase().trim(), 100);
      t.campaign = clip((q.utm_campaign || '').toLowerCase().trim(), 150);
      t.content = clip((q.utm_content || '').toLowerCase().trim(), 100);
      t.term = clip((q.utm_term || '').toLowerCase().trim(), 100);
      if (!t.source) {
        if (t.click_ids.oppref) { t.source = 'chatgpt'; t.medium = t.medium || 'paid_ai'; }
        else if (t.click_ids.gclid || t.click_ids.gbraid || t.click_ids.wbraid) { t.source = 'google'; t.medium = t.medium || 'cpc'; }
        else if (hasPlatform) { t.source = 'meta'; t.medium = t.medium || 'paid_social'; }
        else if (t.click_ids.fbclid) { t.source = 'meta'; t.medium = t.medium || 'social'; }
      }
      var aiSrc = aiEngineForUtmSource(t.source);
      if (aiSrc) {
        t.source = aiSrc;
        if (t.click_ids.oppref) { t.medium = t.medium || 'paid_ai'; }
        else if (!t.medium) { t.medium = 'organic_ai'; }
      }
      return t;
    }
    if (hasHandoff) {
      t.source = 'vdc_website'; t.medium = 'handoff';
      return t;
    }
    var r = classifyReferrer();
    if (r === null) { return null; }
    t.source = r.source; t.medium = r.medium;
    return t;
  }

  // ------------------------------------------------------------- state
  var state = {
    visitorId: null,
    session: null,
    firstTouch: null,
    queue: [],
    pageInfoSent: false
  };

  function deviceType() {
    var ua = navigator.userAgent || '';
    if (/iPad|Tablet/i.test(ua)) { return 'tablet'; }
    if (/Mobi|Android|iPhone/i.test(ua)) { return 'mobile'; }
    return 'desktop';
  }

  function loadVisitor(q) {
    var incoming = q.vdc_vid;
    var stored = sget('vdc_vid');
    var mergedFrom = null;
    if (incoming && VID_RE.test(incoming)) {
      if (stored && stored !== incoming && VID_RE.test(stored)) { mergedFrom = stored; }
      state.visitorId = incoming;
      sset('vdc_vid', incoming);
    } else if (stored && VID_RE.test(stored)) {
      state.visitorId = stored;
    } else {
      state.visitorId = newId('v');
      sset('vdc_vid', state.visitorId);
    }
    return mergedFrom;
  }

  function startSession(touch, extra) {
    var t = nowMs();
    var s = {
      id: newId('s'), start: t, last: t,
      source: touch.source || 'direct', medium: touch.medium || 'none',
      campaign: touch.campaign || '', content: touch.content || '', term: touch.term || '',
      landing: location.pathname
    };
    state.session = s;
    writeJSON('vdc_sess', s);

    var isFirstEver = false;
    if (!state.firstTouch) {
      state.firstTouch = {
        source: s.source, medium: s.medium, campaign: s.campaign, content: s.content,
        landing: s.landing, ts: new Date(t).toISOString()
      };
      writeJSON('vdc_ft', state.firstTouch);
      isFirstEver = true;
    }
    var refHost = '';
    try { refHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { refHost = ''; }
    var props = {
      landing_path: s.landing,
      referrer_host: clip(refHost, 100),
      device: deviceType(),
      language: clip(navigator.language || '', 20),
      viewport: (window.innerWidth || 0) + 'x' + (window.innerHeight || 0),
      is_new_visitor: isFirstEver,
      first_touch_source: state.firstTouch.source,
      first_touch_medium: state.firstTouch.medium,
      first_touch_campaign: state.firstTouch.campaign
    };
    var k;
    if (touch.click_ids) { for (k in touch.click_ids) { if (touch.click_ids.hasOwnProperty(k)) { props[k] = touch.click_ids[k]; } } }
    if (touch.platform_ids) { for (k in touch.platform_ids) { if (touch.platform_ids.hasOwnProperty(k)) { props[k] = touch.platform_ids[k]; } } }
    if (extra) { for (k in extra) { if (extra.hasOwnProperty(k) && extra[k]) { props[k] = extra[k]; } } }
    emit('session_start', props, true);
  }

  function ensureSession() {
    var t = nowMs();
    var s = state.session;
    if (s && (t - s.last) <= cfg.sessionMinutes * 60000) {
      s.last = t;
      writeJSON('vdc_sess', s);
      return;
    }
    // expired while the page stayed open: keep the previous touch, mark as resumed
    var prev = s || { source: 'direct', medium: 'none', campaign: '', content: '', term: '' };
    startSession({ source: prev.source, medium: prev.medium, campaign: prev.campaign,
                   content: prev.content, term: prev.term, click_ids: {} }, { resumed: 'true' });
  }

  // ------------------------------------------------------------- page context
  function dataAttr(name) {
    var v = null;
    if (document.body && document.body.getAttribute) { v = document.body.getAttribute('data-' + name); }
    if (!v && document.documentElement) { v = document.documentElement.getAttribute('data-' + name); }
    return v || '';
  }
  var override = { service: null, secondary: null, pageType: null };
  function pageCtx() {
    return {
      service_id: override.service !== null ? override.service : clip(dataAttr('service-id'), 50),
      secondary_service_id: override.secondary !== null ? override.secondary : clip(dataAttr('secondary-service-id'), 50),
      page_type: override.pageType !== null ? override.pageType : clip(dataAttr('page-type'), 50)
    };
  }

  // ------------------------------------------------------------- props sanitising
  var PII_KEY = /(name|phone|mobile|tel|email|mail|address|dob|birth|diagnos|note|message|comment|passport|emirates|insurance|patient|symptom|allerg|medic)/i;
  function sanitize(props) {
    var out = {};
    if (!props || typeof props !== 'object') { return out; }
    for (var k in props) {
      if (!props.hasOwnProperty(k)) { continue; }
      var v = props[k];
      if (PII_KEY.test(k)) { log('dropped property (looks personal):', k); continue; }
      if (typeof v === 'string') { out[k] = clip(v, 200); }
      else if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; }
    }
    return out;
  }

  // ------------------------------------------------------------- sending
  function send(evt) {
    if (!cfg.endpoint) { log('no endpoint configured, event not sent', evt.event_name); return; }
    var body = JSON.stringify({ sdk: VERSION, env: cfg.env, events: [evt] });
    var ok = false;
    try {
      if (navigator.sendBeacon) {
        ok = navigator.sendBeacon(cfg.endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      }
    } catch (e) { ok = false; }
    if (!ok) {
      try {
        fetch(cfg.endpoint, {
          method: 'POST', body: body, keepalive: true, mode: 'cors', credentials: 'omit',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
        }).catch(function () { /* ignore */ });
      } catch (e2) { /* ignore */ }
    }
  }

  function buildEvent(name, props, isSessionStart) {
    var ctx = pageCtx();
    var s = state.session;
    var evt = {
      event_id: newId('e'),
      event_name: name,
      timestamp: new Date().toISOString(),
      visitor_id: state.visitorId,
      session_id: s ? s.id : '',
      env: cfg.env,
      service_id: ctx.service_id,
      secondary_service_id: ctx.secondary_service_id,
      page_type: ctx.page_type,
      page_path: location.pathname,
      page_url: location.protocol + '//' + location.host + location.pathname,
      source: s ? s.source : '',
      medium: s ? s.medium : '',
      campaign: s ? s.campaign : '',
      content: s ? s.content : '',
      props: isSessionStart ? props : sanitize(props)
    };
    return evt;
  }

  function dispatch(evt) {
    if (cfg.debug) { debugLog.push(evt); if (debugLog.length > 100) { debugLog.shift(); } }
    log(evt.event_name, evt);
    send(evt);
  }

  function emit(name, props, isSessionStart) {
    if (consent === 'denied') { return null; }
    var evt = buildEvent(name, props, isSessionStart);
    if (consent === 'pending') {
      if (state.queue.length < 50) { state.queue.push(evt); }
      return evt.event_id;
    }
    dispatch(evt);
    return evt.event_id;
  }

  function track(name, props) {
    if (!name || typeof name !== 'string') { return null; }
    if (consent === 'denied') { return null; }
    ensureSession();
    return emit(clip(name, 60), props, false);
  }

  // ------------------------------------------------------------- page view
  function pageView() {
    ensureSession();
    var ctx = pageCtx();
    var id = emit('page_view', {}, false);
    var extra = null;
    switch (ctx.page_type) {
      case 'service_page': extra = 'service_view'; break;
      case 'landing_page': extra = 'landing_page_view'; break;
      case 'doctor_profile': extra = 'doctor_profile_view'; break;
      case 'pricing': extra = 'pricing_view'; break;
      default: extra = null;
    }
    if (extra) { emit(extra, {}, false); }
    return id;
  }

  // ------------------------------------------------------------- handoff links (Chattop)
  function decorateUrl(url) {
    if (consent !== 'granted') { return url; }
    try {
      var u = new URL(url, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') { return url; }
      if (!hostIn(cfg.handoffHosts, u.hostname)) { return url; }
      if (state.visitorId) { u.searchParams.set('vdc_vid', state.visitorId); }
      if (state.session) { u.searchParams.set('vdc_ref', state.session.id); }
      return u.toString();
    } catch (e) { return url; }
  }
  function decorateAnchor(a) {
    if (!a || !a.getAttribute) { return; }
    var href = a.getAttribute('href');
    if (!href) { return; }
    var next = decorateUrl(href);
    if (next !== href) { a.setAttribute('href', next); }
  }
  function decorateAll() {
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) { decorateAnchor(links[i]); }
  }

  // ------------------------------------------------------------- click + form listeners
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if (el.matches ? el.matches(sel) : (el.msMatchesSelector && el.msMatchesSelector(sel))) { return el; }
      el = el.parentNode;
    }
    return null;
  }

  function onPointer(e) {
    var a = closest(e.target, 'a[href]');
    if (a) { decorateAnchor(a); }
  }

  function onClick(e) {
    var a = closest(e.target, 'a[href]');
    if (a) { decorateAnchor(a); }
    var tagged = closest(e.target, '[data-vdc-event]');
    if (tagged) {
      var props = {};
      var label = tagged.getAttribute('data-vdc-label');
      if (label) { props.label = label; }
      track(tagged.getAttribute('data-vdc-event'), props);
      return;
    }
    if (!a) { return; }
    var href = (a.getAttribute('href') || '');
    if (/^tel:/i.test(href)) { track('phone_click', {}); return; }
    try {
      var u = new URL(href, location.href);
      if (hostIn(cfg.handoffHosts, u.hostname)) { track('booking_click', {}); }
    } catch (err) { /* ignore */ }
  }

  var FORM_FIELDS = ['visitor_id', 'session_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                     'service_id', 'landing_page', 'gclid', 'fbclid', 'oppref'];
  function formValues() {
    var s = state.session || {};
    var ft = state.firstTouch || {};
    var ctx = pageCtx();
    var clicks = (s && s.click_ids) || {};
    return {
      visitor_id: state.visitorId || '',
      session_id: s.id || '',
      utm_source: s.source || '',
      utm_medium: s.medium || '',
      utm_campaign: s.campaign || '',
      utm_content: s.content || '',
      service_id: ctx.service_id || '',
      landing_page: s.landing || ft.landing || location.pathname,
      gclid: clicks.gclid || '',
      fbclid: clicks.fbclid || '',
      oppref: clicks.oppref || ''
    };
  }
  function fillForm(form) {
    var vals = formValues();
    for (var i = 0; i < FORM_FIELDS.length; i++) {
      var name = FORM_FIELDS[i];
      var inp = form.querySelector('[name="' + name + '"]');
      if (inp) { inp.value = vals[name]; }
    }
  }
  function fillAllForms() {
    var forms = document.querySelectorAll('form[data-vdc-form]');
    for (var i = 0; i < forms.length; i++) { fillForm(forms[i]); }
  }
  function formLabel(f) { return clip(f.getAttribute('data-vdc-form') || f.id || 'form', 60); }

  function onFocusIn(e) {
    var f = e.target && (e.target.form || closest(e.target, 'form'));
    if (f && f.hasAttribute && f.hasAttribute('data-vdc-form') && !f.__vdcStarted) {
      f.__vdcStarted = true;
      track('form_start', { form: formLabel(f) });
    }
  }
  function onSubmit(e) {
    var f = e.target;
    if (f && f.hasAttribute && f.hasAttribute('data-vdc-form')) {
      fillForm(f);
      track('form_submit', { form: formLabel(f) });
    }
  }

  // ------------------------------------------------------------- SPA support
  var lastPath = location.pathname;
  function onRouteChange() {
    if (location.pathname === lastPath) { return; }
    lastPath = location.pathname;
    pageView();
    decorateAll();
  }
  function hookHistory() {
    var ps = history.pushState, rs = history.replaceState;
    history.pushState = function () { var r = ps.apply(this, arguments); setTimeout(onRouteChange, 0); return r; };
    history.replaceState = function () { var r = rs.apply(this, arguments); setTimeout(onRouteChange, 0); return r; };
    window.addEventListener('popstate', onRouteChange);
  }

  // ------------------------------------------------------------- init
  function init() {
    var q = parseQuery();
    var incomingRef = q.vdc_ref && SID_RE.test(q.vdc_ref) ? q.vdc_ref : '';
    var hadVid = q.vdc_vid && VID_RE.test(q.vdc_vid);
    var mergedFrom = loadVisitor(q);
    state.firstTouch = readJSON('vdc_ft');

    var touch = detectTouch(q, !!(incomingRef || hadVid));
    var s = readJSON('vdc_sess');
    var t = nowMs();
    var expired = !s || (t - s.last) > cfg.sessionMinutes * 60000;
    var changed = !!(touch && touch.explicit && s &&
      (touch.source !== s.source || touch.medium !== s.medium || touch.campaign !== s.campaign ||
       touch.content !== s.content || (touch.platform_ids && touch.platform_ids.meta_ad_id && touch.platform_ids.meta_ad_id !== s.meta_ad_id)));

    if (expired || changed) {
      if (!touch) { touch = { source: 'direct', medium: 'none', campaign: '', content: '', term: '', click_ids: {} }; }
      startSession(touch, { parent_session_id: incomingRef, merged_from_visitor_id: mergedFrom });
      if (state.session) {
        if (touch.click_ids) { state.session.click_ids = touch.click_ids; }
        if (touch.platform_ids && touch.platform_ids.meta_ad_id) { state.session.meta_ad_id = touch.platform_ids.meta_ad_id; }
        writeJSON('vdc_sess', state.session);
      }
    } else {
      state.session = s;
      s.last = t;
      writeJSON('vdc_sess', s);
    }

    // keep URLs clean: remove handoff tokens once read
    if (q.vdc_vid || q.vdc_ref) {
      try {
        var u = new URL(location.href);
        u.searchParams.delete('vdc_vid');
        u.searchParams.delete('vdc_ref');
        window.history.replaceState(window.history.state, '', u.pathname + (u.search || '') + u.hash);
      } catch (e) { /* ignore */ }
    }

    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('contextmenu', onPointer, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('submit', onSubmit, true);

    function ready() {
      decorateAll();
      fillAllForms();
      if (cfg.autoPageView) { pageView(); }
      if (cfg.spa) { hookHistory(); }
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', ready); }
    else { ready(); }
  }

  // ------------------------------------------------------------- public API
  function setConsent(granted) {
    var i;
    if (granted) {
      consent = 'granted';
      rawSet('vdc_consent', 'granted');
      for (i = 0; i < KEYS.length; i++) { if (mem[KEYS[i]]) { rawSet(KEYS[i], mem[KEYS[i]]); } }
      var q = state.queue; state.queue = [];
      for (i = 0; i < q.length; i++) { dispatch(q[i]); }
      decorateAll();
      fillAllForms();
    } else {
      consent = 'denied';
      rawSet('vdc_consent', 'denied');
      for (i = 0; i < KEYS.length; i++) { rawDel(KEYS[i]); }
      mem = {};
      state.queue = [];
    }
  }

  window.VDC = {
    __loaded: true,
    version: VERSION,
    config: cfg,
    track: track,
    pageView: pageView,
    setConsent: setConsent,
    decorateUrl: decorateUrl,
    getIds: function () {
      return { visitor_id: state.visitorId, session_id: state.session ? state.session.id : '',
               vdc_vid: state.visitorId, vdc_ref: state.session ? state.session.id : '' };
    },
    setPage: function (o) {
      o = o || {};
      if ('service_id' in o) { override.service = clip(o.service_id, 50); }
      if ('secondary_service_id' in o) { override.secondary = clip(o.secondary_service_id, 50); }
      if ('page_type' in o) { override.pageType = clip(o.page_type, 50); }
    },
    debugLog: debugLog
  };

  init();
})(window, document);

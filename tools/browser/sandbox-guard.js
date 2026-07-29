/* DLA sandbox guard. Installed before any page code runs.
   Nothing may leave this device. Cross-origin fetch and every sendBeacon are
   swallowed and resolved as an empty failed response, so existing page code
   takes its normal error path without a visible break. */
(function () {
  var w = typeof window !== 'undefined' ? window : this;
  var realFetch = w.fetch ? w.fetch.bind(w) : null;
  var origin = (w.location && w.location.origin) || '';

  function isSameOrigin(url) {
    var s = String(url == null ? '' : url);
    if (!s) return true;
    if (s.indexOf('//') === 0) return false;                 // protocol-relative
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {                    // absolute, any scheme
      return !!origin && s.indexOf(origin + '/') === 0;
    }
    return true;                                             // relative path
  }

  function blockedResponse() {
    return Promise.resolve({
      ok: false,
      status: 0,
      statusText: 'blocked by sandbox guard',
      text: function () { return Promise.resolve(''); },
      json: function () { return Promise.reject(new Error('sandbox: request blocked')); }
    });
  }

  w.fetch = function (input, init) {
    var url = input && input.url ? input.url : input;
    if (!isSameOrigin(url)) {
      if (w.console && w.console.info) w.console.info('[sandbox] blocked outbound request:', String(url));
      return blockedResponse();
    }
    if (!realFetch) return blockedResponse();
    return realFetch(input, init);
  };

  if (typeof navigator !== 'undefined') {
    navigator.sendBeacon = function () { return true; };
  }

  w.__sandboxGuardInstalled = true;
})();

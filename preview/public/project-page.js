/*
 * Project page inquiry form and unit buttons. Used by the hosted page (/p/<slug>) and inlined in the HTML block for
 * WordPress. The form goes to the page's form endpoint (data-hook: the Apps Script public hook that files Website
 * Inquiries), in the original's format: { form: 'project_inquiry', project, page, website (honeypot), name, email,
 * method, phone, unit, message }. The endpoint does its own checks (honeypot, one inquiry per contact per 10 minutes).
 */
(function () {
  'use strict';
  document.querySelectorAll('.bhp').forEach(function (root) {
    var form = root.querySelector('#bhp-inquire form'), hook = root.getAttribute('data-hook') || '';
    root.querySelectorAll('[data-unit]').forEach(function (a) {
      a.addEventListener('click', function () { var s = form && form.querySelector('[name=unit]'); if (s) s.value = a.getAttribute('data-unit'); });
    });
    if (!form || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(hook)) return;
    var msg = form.querySelector('.msg'), busy = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var v = {}; ['website', 'name', 'email', 'method', 'phone', 'unit', 'message'].forEach(function (k) { var el = form.querySelector('[name=' + k + ']'); v[k] = el ? String(el.value).trim() : ''; });
      if (!v.name) { msg.textContent = 'Please enter your name.'; return; }
      if (!v.email && !v.phone) { msg.textContent = 'Please leave your email or phone number.'; return; }
      if (v.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.email)) { msg.textContent = 'That email doesn\'t look right.'; return; }
      busy = true; msg.textContent = 'Sending…';
      var body = JSON.stringify(Object.assign({ form: 'project_inquiry', project: root.getAttribute('data-project') || '', page: String(location.href).slice(0, 300) }, v));
      // no-cors, as the original: the endpoint can't answer cross-site, so a sent request counts as received
      fetch(hook, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
        .then(function () { form.reset(); msg.textContent = 'Thank you! We\'ll get back to you shortly.'; if (window.dataLayer) window.dataLayer.push({ event: 'project_inquiry', project: root.getAttribute('data-project') }); })
        .catch(function () { msg.textContent = 'Sorry, that didn\'t go through. Please try again.'; })
        .then(function () { busy = false; });
    });
  });
})();

// The public LOI signing page (src/loiSign.js serves it at /sign/<token>): draw a signature, tick the box, send it
// back to this same address. No cookies; the page key (data-nonce) ties the submission to this page.
(function () {
  'use strict';
  const form = document.getElementById('signForm'); if (!form) return;
  const pad = document.getElementById('pad'), ctx = pad.getContext('2d'), err = document.getElementById('err'), go = document.getElementById('go');
  let drawing = false, inked = false, last = null;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pad.width, pad.height);
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  const pos = (e) => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; };
  pad.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); e.preventDefault(); });
  pad.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; inked = true; e.preventDefault(); });
  const stop = () => { drawing = false; }; pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop);
  document.getElementById('clr').addEventListener('click', () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pad.width, pad.height); inked = false; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    const name = document.getElementById('nm').value.trim();
    if (!name) { err.textContent = 'Enter your full name.'; return; }
    if (!inked) { err.textContent = 'Draw your signature in the box.'; return; }
    if (!document.getElementById('agree').checked) { err.textContent = 'Tick the box to agree to sign electronically.'; return; }
    go.disabled = true; go.textContent = 'Sending…';
    try {
      const r = await fetch('/sign/' + encodeURIComponent(form.dataset.token), { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, agree: true, signature: pad.toDataURL('image/png'), nonce: form.dataset.nonce }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Your signature could not be sent. Try again.');
      form.outerHTML = '<div class="box" role="status"><b>Signed.</b> ' + (d.message || 'Thank you.').replace(/[<>&]/g, '') + '</div>';
    } catch (x) { err.textContent = x.message; go.disabled = false; go.textContent = 'Sign & send back'; }
  });
})();

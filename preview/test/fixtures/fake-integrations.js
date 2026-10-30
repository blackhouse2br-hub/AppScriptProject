'use strict';
// Local fake Monday.com + respond.io API with fictional records, for tests and local UI checks. Never contacts a real service.
// Dates and message times are relative to "now", so status rules (5-day LOI rule, Hot/Lost, days in stage) are exercised.
const http = require('http');

const DAY = 864e5;
// local calendar day, as the pipeline reads date-only values (noon local time); a UTC day made day counts depend on the clock
const ymd = (offsetDays) => { const d = new Date(Date.now() + offsetDays * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const col = (id, title, type, labels) => ({ id, title, type, settings_str: labels ? JSON.stringify({ labels: Object.fromEntries(labels.map((l, i) => [String(i), l])) }) : '{}' });
// 1×1 PNG (fictional photo)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function boards() {
  return {
    '1111111': {
      name: 'Direct Clients (fake)',
      columns: [col('name', 'Name', 'name'), col('cn', 'Contact Name', 'text'), col('ph', 'Phone', 'phone'),
        col('va1', 'VA Assigned', 'status', ['Ana', 'Bea', 'Cora Fake', 'Dev Fake']),
        col('src', 'Leads From', 'status', ['Respond IO', 'Website']), col('inq', 'Inquiry Type', 'status', ['Rent', 'Buy']),
        col('cs', 'Client Status', 'status', ['Qualified', 'Failed']), col('na', 'Next Action', 'status', ['New Inquiry', 'Schedule Viewing', 'For Validation']),
        col('st', 'Status', 'status', ['Working on it']), col('city', 'City', 'text'), col('bud', 'Budget', 'text'), col('br', 'No. of Bedrooms', 'dropdown'),
        col('mi', 'Target Move-in Date', 'date'), col('dq', 'Date of Inquiry', 'date'), col('cd', 'Contract Date', 'date'),
        col('ai', 'AI STATUS', 'status', ['Property Matching', 'Scheduling', 'LOI']), col('ait', 'AI Status Detail', 'long_text'),
        col('rid', 'Respond ID', 'text'), col('sp', 'Salesperson', 'status', ['Ely Santos', 'Gia Cruz', 'Hal Fake'])],
      items: [
        { id: '9001', name: 'BH-T1', group: 'ALL CLIENTS', v: { cn: 'Test Client One', ph: '+63 900 555 0001', va1: 'Ana', src: 'Respond IO', inq: 'Rent', cs: 'Qualified', city: 'Makati', bud: '₱200k - 250k', br: '2', mi: '2026-12-01', dq: ymd(-20), ai: 'Scheduling', ait: 'Scheduling — Viewing set for Saturday', rid: '555001', sp: 'Ely Santos' } },
        { id: '9002', name: 'BH-T2', group: 'Archive', v: { cn: 'Archived Client', va1: 'Ana' } },
        { id: '9003', name: 'BH-T3', group: 'ALL CLIENTS', v: { cn: 'Test Client Three', va1: 'Bea', inq: 'Buy', bud: '25M', dq: ymd(-30), rid: '555003', sp: 'Gia Cruz' } },
        { id: '9004', name: 'BH-T4', group: 'ALL CLIENTS', v: { cn: 'Hidden By Status', va1: 'Ana', na: 'For Validation' } },
        { id: '9005', name: 'BH-T5', group: 'ALL CLIENTS', v: { cn: 'Failed Client', va1: 'Cora Fake', cs: 'Failed', inq: 'Rent', dq: ymd(-40) } },
        { id: '9006', name: 'BH-T6', group: 'ALL CLIENTS', v: { cn: 'Hot Client', va1: 'Ana', na: 'Schedule Viewing', inq: 'Rent', dq: ymd(-3), rid: '555006' } },
      ],
    },
    '2222222': {
      name: 'Listings (fake)',
      columns: [col('name', 'Name', 'name'), col('bn', 'Building Name', 'text'), col('loc', 'Location', 'text'), col('lt', 'Listing Type', 'status'),
        col('bed', 'Bedrooms', 'status'), col('pr', 'Price', 'numbers'), col('av', 'Availability', 'status'), col('pho', 'Photos', 'file')],
      items: [
        { id: '7001', name: 'Owner A', group: 'Available Units', v: { bn: 'Fake Tower', loc: 'Makati', lt: 'For Rent', bed: '2 BR', pr: '180000', av: 'Available', pho: { files: ['30003', '30001'] } },
          assets: [['30001', 'png'], ['30002', 'pdf'], ['30003', 'png']] },
        { id: '7002', name: 'Owner B', group: 'Archive', v: { bn: 'Old Tower', loc: 'Pasig', lt: 'For Rent', av: 'Available' } },
        { id: '7003', name: 'Owner C', group: 'Available Units', v: { bn: 'Svg Tower', loc: 'Pasig', lt: 'For Rent', av: 'Available' }, assets: [['30009', 'png']] },
      ],
    },
    '3333333': {
      name: 'Calendar (fake)',
      columns: [col('name', 'Name', 'name'), col('fs', 'Final Schedule', 'date'), col('cl', 'Clients', 'board_relation'), col('b', 'Building', 'mirror'),
        col('c', 'City', 'mirror'), col('tm', 'Time', 'text'), col('sp', 'Salesperson', 'status'), col('st', 'Status', 'status'),
        col('dl', 'Date LOI Submitted', 'date'), col('tp', 'Total Paid', 'numbers')],
      items: [
        { id: '6001', name: 'Viewing 1', group: 'Viewings', created: ymd(-6), v: { fs: '2026-11-02', cl: { linked: ['9001'] }, b: 'Fake Tower', c: 'Makati', tm: '2:30 PM', sp: 'Ely Santos', st: 'Confirmed' } },
        { id: '6002', name: 'Viewing 2', group: 'Viewings', created: ymd(-10), v: { fs: '2026-11-03', cl: { linked: ['9003'] }, b: 'Other', c: 'Pasig', tm: '10:00', sp: 'Gia Cruz', st: 'Pending', dl: ymd(-2) } },
      ],
    },
  };
}
let BOARDS = boards();
const calls = { monday: [], respond: [], files: [] };

function itemOut(boardId, it, colIds, host) {
  const cols = BOARDS[boardId].columns;
  return { id: it.id, name: it.name, created_at: (it.created || '2026-10-01') + 'T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', group: { id: 'g', title: it.group },
    assets: (it.assets || []).map(([id, ext]) => ({ id, file_extension: '.' + ext, public_url: `http://${host}/files/${id}.${ext}`, url_thumbnail: `http://${host}/files/${id}.${ext}` })),
    column_values: colIds.map((id) => { const raw = it.v[id]; const c = cols.find((x) => x.id === id);
      if (raw && raw.linked) return { id, text: '', value: null, linked_item_ids: raw.linked };
      if (raw && raw.files) return { id, text: raw.files.join(', '), value: JSON.stringify({ files: raw.files.map((f) => ({ assetId: Number(f), name: f + '.png' })) }) };
      return { id, text: raw || '', value: null, ...(c && c.type === 'mirror' ? { display_value: raw || '' } : {}) }; }) };
}
function fakeMonday(body, auth, host) {
  if (auth === 'bad-token') return [401, { error_message: 'Not Authenticated' }];
  const { query, variables: v } = body;
  // the portal's single allowed mutation (one column of one item); anything else is answered as an unexpected query
  if (/^\s*mutation\b/.test(query)) {
    if (!/^mutation \(\$b: ID!, \$i: ID!, \$c: String!, \$v: String\) \{ change_simple_column_value\(board_id: \$b, item_id: \$i, column_id: \$c, value: \$v\) \{ id \} \}$/.test(query)) return [400, { errors: [{ message: 'unexpected mutation' }] }];
    const b = BOARDS[String(v.b)], it = b && b.items.find((x) => x.id === String(v.i)), c = b && b.columns.find((x) => x.id === v.c);
    if (!it || !c) return [200, { errors: [{ message: 'Item or column not found' }] }];
    it.v[v.c] = v.v;
    return [200, { data: { change_simple_column_value: { id: it.id } } }];
  }
  // one item re-read after a write
  if (/items\(ids: \$i\) \{ id name/.test(query)) {
    const bid = Object.keys(BOARDS).find((k) => BOARDS[k].items.some((x) => x.id === String(v.i[0])));
    const it = bid && BOARDS[bid].items.find((x) => x.id === String(v.i[0]));
    return [200, { data: { items: it ? [itemOut(bid, it, v.c, host)] : [] } }];
  }
  if (/next_items_page/.test(query)) {
    const [boardId, offset] = v.k.split(':');
    return [200, { data: { next_items_page: { cursor: null, items: BOARDS[boardId].items.slice(+offset).map((it) => itemOut(boardId, it, v.c, host)) } } }];
  }
  if (/items_page/.test(query)) {
    const boardId = String(v.b[0]), b = BOARDS[boardId];
    return [200, { data: { boards: b ? [{ items_page: { cursor: boardId + ':2', items: b.items.slice(0, 2).map((it) => itemOut(boardId, it, v.c, host)) } }] : [] } }];
  }
  if (/updates/.test(query)) return [200, { data: { items: [{ id: v.i[0], updates: [{ id: 'u1', text_body: 'Monday update text', created_at: '2026-10-05T00:00:00Z', creator: { name: 'Fake VA' } }] }] } }];
  // a renewed link (?renewed=1); 30026 was deleted on Monday, so it has none
  if (/assets\(ids/.test(query)) return [200, { data: { assets: v.ids.filter((id) => id !== '30026').map((id) => ({ id, public_url: `http://${host}/files/${id}.png?renewed=1`, url_thumbnail: `http://${host}/files/${id}.png` })) } }];
  if (/me \{/.test(query)) return [200, { data: { me: { name: 'Fake Token User' }, boards: v.b.filter((id) => BOARDS[id]).map((id) => ({ id, name: BOARDS[id].name })) } }];
  if (/columns/.test(query)) { const b = BOARDS[String(v.b[0])]; return [200, { data: { boards: b ? [{ id: v.b[0], name: b.name, columns: b.columns }] : [] } }]; }
  return [400, { errors: [{ message: 'unexpected query' }] }];
}
const sec = (hoursAgo) => Math.round((Date.now() - hoursAgo * 3600e3) / 1000);
const msg = (id, traffic, text, hoursAgo, source) => ({ messageId: id, traffic, ...(source ? { sender: { source } } : {}), message: { type: 'text', text }, status: [{ value: traffic === 'incoming' ? 'received' : 'delivered', timestamp: sec(hoursAgo) }] });
const CHATS = () => ({
  // client asked 3+ days ago, a VA answered 2 days ago → Waiting on Client; last client message 3 days ago → Lost
  '555001': [msg(2, 'outgoing', 'Hi, how can we help?', 48, 'user'), msg(1, 'incoming', 'Hello, is the unit available?', 80)],
  // VA replied 5 h ago, client sent two messages since, then an automated workflow message → still Needs VA Reply, Hot
  '555006': [msg(14, 'outgoing', 'Auto-reply: we will get back to you', 0.5, 'workflow'), msg(13, 'incoming', 'Can I view tomorrow?', 1), msg(12, 'incoming', 'Hello again', 2), msg(11, 'outgoing', 'Sure, sending options', 5, 'user')],
  // a reply to a services offer (Service Requests "Check replies"): the offer is logged by the test just before this
  // (the reply carries the client's own name, number, email, unit and a link: the portal must never pass these to the AI)
  '555007': [msg(21, 'outgoing', 'Hi Sofia! Moving soon? Blackhouse can arrange trusted movers for you.', 0.02, 'api'),
    msg(22, 'incoming', 'Yes please, this is Sofia Reyes. I move out next Saturday from Unit 12B, 2 bedrooms of furniture. Call me on +63 917 555 0199 or sofia.reyes@example.com, photos at https://photos.example.com/sofia', 0.01)],
});
// respond.io channels of the fake workspace (the Upselling channel picker)
const CHANNELS = [{ id: 7701, name: 'Blackhouse WhatsApp (fake)', source: 'whatsapp_cloud' }, { id: 7702, name: 'Blackhouse Viber (fake)', source: 'viber' }];
function fakeRespond(path, auth, method) {
  if (auth === 'Bearer bad-token') return [401, { message: 'Unauthorized' }];
  if (path === '/space/channel') return method === 'GET' ? [200, { items: CHANNELS }] : [405, {}];
  // sends (only reached when a test switches sending on): accepted, and recorded with their bodies by the server below
  if (method === 'POST') {
    if (!/^\/contact\/id:\d+\/(message|tag)$/.test(path)) return [405, {}];
    if (/^\/contact\/id:555003\//.test(path)) return [404, { message: 'Contact not found' }];   // a Respond ID with no contact
    return [200, { contactId: Number(path.match(/\d+/)[0]), messageId: 1 }];
  }
  const m = path.match(/^\/contact\/id:(\d+)(\/message\/list)?/);
  if (!m) return [404, {}];
  if (m[1] === '555003') return [404, { message: 'not found' }];
  if (!m[2]) return [200, { id: Number(m[1]), firstName: 'Fake', lastName: 'Contact', lifecycle: 'ASSIGNED TO VA', assignee: { firstName: 'Ana' } }];
  return [200, { items: CHATS()[m[1]] || [], pagination: {} }];
}
function createFakeServer() {
  return http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (req.url.startsWith('/files/')) {
        calls.files.push({ method: req.method, auth: req.headers.authorization || '', path: req.url });
        const [file, qs] = req.url.split('?'), renewed = /renewed=1/.test(qs || '');
        // 30020/30026: the cached signed link has expired (S3 answers 403); 30021: the file host fails; 30022: a PDF
        // labelled image/jpeg; 30025: an HTML page; 30023: over 10 MB by its length; 30024: over 10 MB with no length
        if (/3002[06]/.test(file) && !renewed) { res.writeHead(403, { 'content-type': 'application/xml' }); return res.end('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>'); }
        if (/30021/.test(file)) { res.writeHead(500, { 'content-type': 'application/xml' }); return res.end('<Error/>'); }
        if (/30022/.test(file)) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end('%PDF-1.4 fake document'); }
        if (/30025/.test(file)) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Log in</title>'); }
        if (/30023/.test(file)) { res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(11 * 1024 * 1024) }); return res.end(); }
        if (/30024/.test(file)) {
          res.writeHead(200, { 'content-type': 'image/png' });   // chunked: no content-length
          const chunk = Buffer.alloc(1024 * 1024); let n = 0;
          const more = () => { while (n < 12) { n++; if (!res.write(n === 1 ? Buffer.concat([PNG, chunk]) : chunk)) return res.once('drain', more); } res.end(); };
          res.on('error', () => {}); req.socket.on('error', () => {}); return more();
        }
        if (/\.png$/.test(file) && !/30009/.test(file)) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
        res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      }
      let out;
      if (req.url === '/monday') { calls.monday.push({ method: req.method, auth: req.headers.authorization, body: JSON.parse(data || '{}') }); out = fakeMonday(JSON.parse(data || '{}'), req.headers.authorization, req.headers.host); }
      else if (req.url.startsWith('/respond')) { const p = req.url.slice('/respond'.length); let b = null; try { b = data ? JSON.parse(data) : null; } catch (e) { /* not JSON */ }
        calls.respond.push({ method: req.method, auth: req.headers.authorization, path: p, body: b }); out = fakeRespond(p, req.headers.authorization, req.method); }
      else out = [404, {}];
      res.writeHead(out[0], { 'content-type': 'application/json' }); res.end(JSON.stringify(out[1]));
    });
  });
}

module.exports = { createFakeServer, calls, get BOARDS() { return BOARDS; } };

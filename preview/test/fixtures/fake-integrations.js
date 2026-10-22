'use strict';
// Local fake Monday.com + respond.io API with fictional records, for tests and local UI checks. Never contacts a real service.
// Dates and message times are relative to "now", so status rules (5-day LOI rule, Hot/Lost, days in stage) are exercised.
const http = require('http');

const DAY = 864e5;
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
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
  if (/next_items_page/.test(query)) {
    const [boardId, offset] = v.k.split(':');
    return [200, { data: { next_items_page: { cursor: null, items: BOARDS[boardId].items.slice(+offset).map((it) => itemOut(boardId, it, v.c, host)) } } }];
  }
  if (/items_page/.test(query)) {
    const boardId = String(v.b[0]), b = BOARDS[boardId];
    return [200, { data: { boards: b ? [{ items_page: { cursor: boardId + ':2', items: b.items.slice(0, 2).map((it) => itemOut(boardId, it, v.c, host)) } }] : [] } }];
  }
  if (/updates/.test(query)) return [200, { data: { items: [{ id: v.i[0], updates: [{ id: 'u1', text_body: 'Monday update text', created_at: '2026-10-05T00:00:00Z', creator: { name: 'Fake VA' } }] }] } }];
  if (/assets\(ids/.test(query)) return [200, { data: { assets: v.ids.map((id) => ({ id, public_url: `http://${host}/files/${id}.png`, url_thumbnail: `http://${host}/files/${id}.png` })) } }];
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
});
function fakeRespond(path) {
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
        if (/\.png$/.test(req.url) && !/30009/.test(req.url)) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
        res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      }
      let out;
      if (req.url === '/monday') { calls.monday.push({ method: req.method, auth: req.headers.authorization, body: JSON.parse(data || '{}') }); out = fakeMonday(JSON.parse(data || '{}'), req.headers.authorization, req.headers.host); }
      else if (req.url.startsWith('/respond')) { const p = req.url.slice('/respond'.length); calls.respond.push({ method: req.method, auth: req.headers.authorization, path: p }); out = fakeRespond(p); }
      else out = [404, {}];
      res.writeHead(out[0], { 'content-type': 'application/json' }); res.end(JSON.stringify(out[1]));
    });
  });
}

module.exports = { createFakeServer, calls, get BOARDS() { return BOARDS; } };

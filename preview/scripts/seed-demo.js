'use strict';
// Optional: fills an EMPTY MongoDB database with the same fictional demo records the browser demo uses
// (DEMO- lead codes, example.com emails, +63 900 555 phone numbers), so you can try MongoDB mode end to end.
//   npm run seed:demo
// Refuses to run if leads, listings or viewings already exist. Team accounts are not seeded:
// create a Manager with `npm run create-manager`, then add people in Settings → Team & Access.
const { loadConfig } = require('../src/config');
const { connectDb, disconnectDb } = require('../src/db');
const { Lead, Listing, Viewing, Note, Template } = require('../src/models');
const { generate } = require('../public/demo-data');

async function seed() {
  const counts = await Promise.all([Lead, Listing, Viewing].map((m) => m.estimatedDocumentCount()));
  if (counts.some((n) => n > 0)) throw new Error('This database already has leads, listings or viewings. Seeding only runs on an empty database.');
  const d = generate(new Date());
  const listingIds = {}, leadIds = {};
  const listings = await Listing.insertMany(d.listings.map(({ id, addedAt, ...x }) => x));
  listings.forEach((doc, i) => { listingIds[d.listings[i].id] = doc._id; });
  const leads = await Lead.insertMany(d.leads.map(({ id, chat, notes, ...l }) => l), { timestamps: false });
  leads.forEach((doc, i) => { leadIds[d.leads[i].id] = doc._id; });
  await Note.insertMany(d.leads.flatMap((l) => l.notes.map((n) => ({ leadId: leadIds[l.id], by: n.by, text: n.text, at: n.at }))));
  await Viewing.insertMany(d.calendar.map(({ id, leadId, listingId, ...v }) => ({ ...v, leadId: leadIds[leadId], listingId: listingIds[listingId], createdBy: 'seed (demo)' })));
  if (!(await Template.estimatedDocumentCount())) await Template.insertMany(d.templates.map(({ id, ...t }) => t));
  return { leads: leads.length, listings: listings.length, viewings: d.calendar.length };
}

if (require.main === module) {
  (async () => {
    const config = loadConfig(process.env, ['--mode=mongo']);
    await connectDb(config.mongoUri);
    try {
      const n = await seed();
      console.log(`Seeded fictional demo data: ${n.leads} leads, ${n.listings} listings, ${n.viewings} viewings.`);
    } finally { await disconnectDb(); }
  })().catch((err) => { console.error('[seed:demo] ' + err.message); process.exit(1); });
}

module.exports = { seed };

'use strict';
// MongoDB models for the records the preview screens use. Monday.com remains the source for live leads;
// these collections hold app-owned data now and an imported snapshot later (see the migration notes in README).
const mongoose = require('mongoose');
const { LISTS, AI_STAGES, TEMPS, ROLES, RESULT, KPI_REVIEW: SH_KPI } = require('../public/shared');

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;
const toJSON = {
  versionKey: false,
  transform(doc, ret) {
    ret.id = String(ret._id); delete ret._id; delete ret.passwordHash; delete ret.googleSub;
    for (const k of ['leadId', 'listingId', 'userId']) if (ret[k]) ret[k] = String(ret[k]);
    return ret;
  },
};
const opts = { timestamps: true, toJSON };

const Lead = mongoose.model('Lead', new Schema({
  code: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
  mondayItemId: { type: String, default: '' },      // filled when leads are imported from Monday in a later phase
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, default: '', maxlength: 20 },
  email: { type: String, default: '', lowercase: true, maxlength: 120 },
  status: { type: String, enum: LISTS.clientStatuses, default: 'New Inquiry' },
  ai: { type: String, enum: AI_STAGES, default: 'Property Matching' },
  // stage from the lead's evidence when ai is 'Not on Respond.io' (pipeline.computeLead); '' = same as ai
  workStage: { type: String, enum: [''].concat(AI_STAGES), default: '' },
  temp: { type: String, enum: TEMPS, default: 'Not on Respond.io' },
  inquiry: { type: String, enum: ['Rent', 'Buy'], default: 'Rent' },
  va: { type: String, enum: [''].concat(LISTS.vas), default: '', index: true },
  salesperson: { type: String, default: '', index: true },
  source: { type: String, default: '' },
  origin: { type: String, enum: ['respond.io', 'Monday'], default: 'Monday' },
  budget: { type: Number, default: 0, min: 0 },
  city: { type: String, default: '' },
  bedrooms: { type: String, default: '' },
  occupants: { type: String, default: '' },
  pets: { type: String, default: '' },   // '' = not specified; 'No Pets' only when chosen
  requirements: { type: String, default: '', maxlength: 500 },
  nationality: { type: String, default: '', maxlength: 60 },
  moveIn: { type: String, default: '' },
  building: { type: String, default: '', maxlength: 120 },
  sqm: { type: String, default: '', maxlength: 40 },
  bathrooms: { type: String, default: '' },
  parking: { type: String, default: '' },
  furnishing: { type: String, default: '' },
  leaseEnd: { type: String, default: '' },
  daysInStage: { type: Number, default: 0 },
  failReason: { type: String, default: '' },
  // respond.io snapshot fields; respond.io itself is not connected in this phase
  onRespond: { type: Boolean, default: false },
  contactId: { type: String, default: '' },
  waiting: { type: String, enum: ['', 'va', 'client'], default: '' },
}, opts));

const Listing = mongoose.model('Listing', new Schema({
  code: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
  building: { type: String, required: true, maxlength: 120 },
  tower: { type: String, default: '' }, floor: { type: Number, default: 0 },
  city: { type: String, default: '' },
  type: { type: String, enum: ['For Rent', 'For Sale'], required: true },
  price: { type: Number, default: 0, min: 0 },
  bedrooms: { type: String, default: '' }, bathrooms: { type: Number, default: 0 }, sizeSqm: { type: Number, default: 0 },
  furnishing: { type: String, default: '' }, parking: { type: Boolean, default: false }, petFriendly: { type: Boolean, default: false },
  availability: { type: String, enum: LISTS.availability, default: 'Available' },
  contact: { type: String, default: '' }, contactPhone: { type: String, default: '' },
  hue: { type: Number, default: 210 },
}, opts));

const Viewing = mongoose.model('Viewing', new Schema({
  leadId: { type: ObjectId, ref: 'Lead', required: true, index: true },
  listingId: { type: ObjectId, ref: 'Listing', required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  time: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  broker: { type: String, required: true, index: true },
  status: { type: String, enum: LISTS.viewingStatuses, default: 'Proposed' },
  feedback: { type: String, default: '', maxlength: 1000 },
  // result of a viewing that happened (Pending Broker Feedback): '' = none yet
  outcome: { type: String, enum: [''].concat(RESULT.outcomes), default: '' },
  feedbackTags: { type: [String], default: [] },
  loiConf: { type: new Schema({ pct: { type: Number, min: 0, max: 100 }, state: { type: String, default: '', maxlength: 500 } }, { _id: false }), default: null },
  outcomeAt: { type: Date, default: null }, outcomeBy: { type: String, default: '' },
  createdBy: { type: String, default: '' },
}, opts));

const Note = mongoose.model('Note', new Schema({
  leadId: { type: ObjectId, ref: 'Lead', required: true, index: true },
  by: { type: String, required: true },
  byUserId: { type: ObjectId, ref: 'User' },
  text: { type: String, required: true, maxlength: 2000 },
  at: { type: Date, default: Date.now },
}, { toJSON }));

// salesLabel: a Broker's exact Salesperson label on Monday (set by an admin in Team & Access); it is what links the
// signed-in broker to Monday Calendar viewings and clients. Empty = no Monday viewings until it is set.
const User = mongoose.model('User', new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  role: { type: String, enum: ROLES, required: true },
  vaLabel: { type: String, default: '' },
  salesLabel: { type: String, default: '', maxlength: 80 },
  phone: { type: String, default: '' },
  modules: { type: Schema.Types.Mixed, default: {} },   // { moduleKey: 'view' | 'edit' }, validated by shared.validateUser
  passwordHash: { type: String, select: false },
  // Google account ID, linked on the first Google sign-in; later sign-ins must come from that same account
  googleSub: { type: String, select: false, index: { unique: true, sparse: true } },
  googleLinkedAt: { type: Date, default: null },   // when that Google account was linked (shown with KPI acknowledgments)
  active: { type: Boolean, default: true },
}, { ...opts, minimize: false }));

const Template = mongoose.model('Template', new Schema({
  name: { type: String, required: true, unique: true, maxlength: 60 },
  language: { type: String, required: true, maxlength: 10 },
  body: { type: String, required: true, maxlength: 1024 },
}, opts));

const Session = mongoose.model('Session', new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true, expires: 0 },   // TTL index: MongoDB deletes expired sessions
  subHash: { type: String, default: '' },   // hash of the Google account that started this session ('' = password sign-in)
}, { timestamps: true }));

// one Google sign-in attempt (10 minutes): state, PKCE verifier and nonce, bound to the browser that started it
const OAuthState = mongoose.model('OAuthState', new Schema({
  stateHash: { type: String, required: true, unique: true },
  browserHash: { type: String, required: true },
  verifier: { type: String, required: true },
  nonce: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
  // 'signin' (src/google.js) or 'drive' (src/driveStore.js, connecting My Drive storage); a state works for its own flow only
  purpose: { type: String, enum: ['signin', 'drive'], default: 'signin' },
  userId: { type: ObjectId, ref: 'User', default: null },   // drive: the Manager who started it (must finish it)
  allowSwitch: { type: Boolean, default: false },            // drive: another Google account may replace the connected one
}));

// ---- portal-only records about leads that may live on Monday.com (source 'monday', read-only there) or in MongoDB ----
// leadId / listingId are the Monday item IDs or MongoDB IDs as text, so the same record works for either source.
const leadRef = {
  source: { type: String, enum: ['monday', 'mongo'], required: true },
  leadId: { type: String, required: true, maxlength: 40 },
};
const by = { name: { type: String, default: '' }, userId: { type: ObjectId, ref: 'User' } };

// "Asking for Availability": one record per lead + listing (the unique index stops duplicates); nothing is sent to anyone
const contactSchema = new Schema({ via: { type: String, enum: ['call', 'whatsapp', 'viber'], required: true }, at: { type: Date, default: Date.now }, by: { type: String, default: '' } }, { _id: false });
const AvailabilityRequest = mongoose.model('AvailabilityRequest', new Schema({
  ...leadRef,
  listingId: { type: String, required: true, maxlength: 40 },
  listingName: { type: String, default: '', maxlength: 160 },
  status: { type: String, enum: ['asking', 'available', 'unavailable'], default: 'asking', index: true },
  // For Client Approval → For Scheduling (Code.gs chk_ answeredAt, sent_ (apiMarkSent), 'interested' viewing (apiMarkAvailable))
  answeredAt: { type: Date, default: null }, sentAt: { type: Date, default: null }, sentBy: { type: String, default: '' },
  interestedAt: { type: Date, default: null }, interestedBy: { type: String, default: '' },
  contacts: { type: [contactSchema], default: [] },   // owner taps (call / WhatsApp / Viber), newest 20 kept
  createdBy: by, updatedBy: by,
}, opts).index({ source: 1, leadId: 1, listingId: 1 }, { unique: true }));

// a portal override of what Monday says, e.g. "Failed" for an unresponsive lead; shown as an override, never written to Monday
const LeadOverride = mongoose.model('LeadOverride', new Schema({
  ...leadRef,
  failed: { type: new Schema({ reason: { type: String, required: true, maxlength: 300 }, at: { type: Date, default: Date.now }, by: { type: String, default: '' }, byUserId: { type: ObjectId, ref: 'User' } }, { _id: false }), default: null },
}, opts).index({ source: 1, leadId: 1 }, { unique: true }));

// one entry per Monday update attempt (allowlisted actions only): who, when, what column of which item, and whether it
// worked. No tokens, client names or contact details; for free text, numbers and dates the value itself isn't kept.
const MondayWrite = mongoose.model('MondayWrite', new Schema({
  action: { type: String, required: true, maxlength: 40 },
  board: { type: String, enum: ['leads', 'listings', 'calendar'], required: true },
  itemId: { type: String, required: true, match: /^\d{1,20}$/ },
  column: { type: String, default: '', maxlength: 80 },
  from: { type: String, default: '', maxlength: 60 }, to: { type: String, default: '', maxlength: 60 },   // status labels only
  ok: { type: Boolean, required: true },
  error: { type: String, default: '', maxlength: 200 },
  by,
}, opts).index({ itemId: 1, createdAt: -1 }));

// the result of a Monday Calendar-board viewing (Code.gs bfb_): the portal keeps the reasons, broker feedback and LOI
// confidence (they shape the client's property suggestions); the Calendar item's Status is written on Monday itself
const ViewingResult = mongoose.model('ViewingResult', new Schema({
  viewingId: { type: String, required: true, unique: true, match: /^\d{1,20}$/ },   // the Calendar item
  leadId: { type: String, required: true, index: true, match: /^\d{1,20}$/ },       // the Direct Clients item
  outcome: { type: String, enum: RESULT.outcomes, required: true },
  tags: { type: [String], default: [] },
  feedback: { type: String, default: '', maxlength: 1000 },
  loiConf: { type: new Schema({ pct: { type: Number, min: 0, max: 100 }, state: { type: String, default: '', maxlength: 500 } }, { _id: false }), default: null },
  unit: { type: new Schema({ building: { type: String, default: '', maxlength: 120 }, city: { type: String, default: '', maxlength: 80 } }, { _id: false }), default: () => ({}) },
  date: { type: String, default: '' },
  mondayStatus: { type: String, default: '', maxlength: 60 },     // the Status label written on the Calendar item
  feedbackOnMonday: { type: Boolean, default: false },
  by: { name: { type: String, default: '' }, userId: { type: ObjectId, ref: 'User' } },
}, opts));

// Renewals → Message: "I sent it from respond.io" (Code.gs apiRenewalLog / rn_). Which template and when — never the
// message text or the client's number. Nothing is sent from the portal.
const RenewalLog = mongoose.model('RenewalLog', new Schema({
  ...leadRef,
  kind: { type: String, required: true, maxlength: 20 },   // a template key (SH.RENEWAL_TEMPLATES)
  by,
}, opts).index({ source: 1, leadId: 1, createdAt: -1 }));

// Daily Report: the team's own extra lines (Code.gs jr_notes) — typed by staff, kept as written
const DailyNote = mongoose.model('DailyNote', new Schema({
  key: { type: String, required: true, unique: true, maxlength: 20 },
  call: { type: String, default: '', maxlength: 2000 },
  extra: { type: String, default: '', maxlength: 4000 },
  by,
}, opts));

// P&L: manual monthly values per line (Code.gs pl_m_<line>); the commission figures come from the Calendar board
const PlCell = mongoose.model('PlCell', new Schema({
  line: { type: String, required: true, maxlength: 30 },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  value: { type: Number, required: true },
  by,
}, opts).index({ line: 1, month: 1 }, { unique: true }));

// ---- KPI Review (src/kpiReview.js): coaching + feedback per VA (a Team & Access member) and reporting month ----
const KPI_KEYS = SH_KPI.reviewers.map((r) => r.key);
const person = { userId: { type: ObjectId, ref: 'User', required: true }, name: { type: String, default: '', maxlength: 80 }, email: { type: String, default: '', maxlength: 120 } };
const personOpt = new Schema({ userId: { type: ObjectId, ref: 'User' }, name: { type: String, default: '', maxlength: 80 } }, { _id: false });
/** Refuses every change to an existing document of this schema: such records are written once and then only read. */
function writeOnce(schema, what) {
  const refuse = () => { const e = new Error(what + ' is read-only once saved.'); e.readOnly = true; throw e; };
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'bulkWrite'].forEach((op) => schema.pre(op, refuse));
  schema.pre('save', function () { if (!this.isNew) refuse(); });
  return schema;
}
// one record per VA, month and reviewer slot (Toby / Jonjo): saving one reviewer's comments never touches the other's.
// `version` guards against two saves from the same reviewer in different tabs or devices overwriting each other.
const KpiFeedback = mongoose.model('KpiFeedback', new Schema({
  employeeId: { type: ObjectId, ref: 'User', required: true },
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  reviewerKey: { type: String, enum: KPI_KEYS, required: true },
  // the coaching form (kpi ref.png). Records saved before it have only coaching / feedback; those are kept and shown.
  achievements: { type: String, default: '', maxlength: SH_KPI.textMax },
  actions: { type: [new Schema({ text: { type: String, required: true, maxlength: SH_KPI.actionMax }, date: { type: String, default: '', match: /^(\d{4}-\d{2}-\d{2})?$/ } }, { _id: false })], default: [] },
  coaching: { type: String, default: '', maxlength: SH_KPI.textMax },
  feedback: { type: String, default: '', maxlength: SH_KPI.textMax },
  author: { type: new Schema(person, { _id: false }), required: true },   // who saved the current text
  createdBy: { type: new Schema(person, { _id: false }), required: true },
  // "Reviewer recorded discussion": the reviewer's own note that they went through it with the employee (not employee verification)
  discussedAt: { type: Date, default: null }, discussedBy: { type: personOpt, default: null },
  discussedVersion: { type: Number, default: 0 },   // the version of the text the discussion record covers
  version: { type: Number, default: 1, min: 1 },
}, opts).index({ employeeId: 1, period: 1, reviewerKey: 1 }, { unique: true }));
// the employee's own "We discussed this review", made while signed in as that employee; one per VA and month, never changed
const KpiAck = mongoose.model('KpiAck', writeOnce(new Schema({
  employeeId: { type: ObjectId, ref: 'User', required: true },
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  by: { type: new Schema(person, { _id: false }), required: true },
  googleLinkedAt: { type: Date, default: null },   // when the acknowledging account's Google sign-in was linked to the member
  reviewVersions: { type: Schema.Types.Mixed, default: {} },   // { toby: n, jonjo: n }: the review text versions acknowledged
}, { timestamps: { createdAt: true, updatedAt: false }, toJSON, minimize: false }).index({ employeeId: 1, period: 1 }, { unique: true }), 'An acknowledgment'));
// a manual monthly snapshot: copies (not references) of names, KPI values and labels, comments, reviewers and acknowledgment
// at capture time. One per reporting month and scope (unique index, so concurrent requests can't both create one); read-only.
const snapPerson = { userId: { type: ObjectId, ref: 'User' }, name: { type: String, default: '' }, email: { type: String, default: '' } };
const kpiValue = new Schema({ key: String, label: String, value: { type: Number, default: null }, unit: { type: String, default: '' } }, { _id: false });
const KpiSnapshot = mongoose.model('KpiSnapshot', writeOnce(new Schema({
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  scope: { type: String, required: true, enum: [SH_KPI.scope] },
  timezone: { type: String, required: true },
  source: { type: String, enum: ['monday', 'mongo'], required: true },
  dataReadAt: { type: Date, default: null },   // when the KPI data was read (Monday copy time, or capture time for MongoDB)
  createdBy: { type: new Schema({ ...snapPerson, as: { type: String, default: '' } }, { _id: false }), required: true },
  employees: [new Schema({
    employeeId: { type: ObjectId, ref: 'User', default: null },   // null: a VA label with no Team & Access member yet
    name: { type: String, default: '' }, vaLabel: { type: String, default: '' },
    kpis: { month: [kpiValue], current: [kpiValue] },
    reviews: [new Schema({ reviewerKey: String, reviewerLabel: String, reviewer: snapPerson, coaching: String, feedback: String,
      achievements: { type: String, default: '' }, actions: { type: [new Schema({ text: String, date: String }, { _id: false })], default: [] },
      updatedAt: Date, version: Number, discussedAt: { type: Date, default: null }, discussedVersion: { type: Number, default: 0 } }, { _id: false })],
    ack: { type: new Schema({ status: { type: String, enum: ['acknowledged', 'not_acknowledged', 'not_available'], required: true },
      by: { type: new Schema(snapPerson, { _id: false }), default: null }, at: { type: Date, default: null } }, { _id: false }), required: true },
  }, { _id: false })],
}, { timestamps: { createdAt: true, updatedAt: false }, toJSON }).index({ period: 1, scope: 1 }, { unique: true }), 'A snapshot'));

// ---- Project Pages (src/projects.js): one developer project per record, with its units and media (src/projectMedia.js) ----
const PP = require('../public/shared').PROJECT;
const str = (max, def = '') => ({ type: String, default: def, maxlength: max, trim: true });
const ppUnit = new Schema({ type: str(80), bedrooms: str(20), sizeSqm: str(20), priceFrom: str(60), availability: str(40, 'Available'), notes: str(300),
  media: str(24) }, { _id: false });   // media: the id of one of the project's images (a photo or floor plan), '' = none
const ppMedia = new Schema({
  id: { type: String, required: true, match: /^[a-f0-9]{24}$/ },   // the stored file (GridFS)
  name: str(120), type: { type: String, enum: ['image', 'pdf'], required: true }, kind: { type: String, enum: PP.kinds, default: 'photo' },
  caption: str(200), use: { type: Boolean, default: true },   // use=false: kept, but left off the page
  from: { type: String, enum: ['upload', 'drive'], default: 'upload' }, driveId: str(100), size: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now }, by: str(80),
}, { _id: false });
const Project = mongoose.model('Project', new Schema({
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9-]{1,60}$/ },   // the page address (fixed once created)
  name: { type: String, required: true, trim: true, maxlength: 120 }, developer: str(120), location: str(160), status: str(40, 'Pre-selling'),
  turnover: str(60), priceFrom: str(60), tagline: str(200), description: str(PP.descriptionMax), map: str(200),
  video: str(300), pageUrl: str(300), driveLink: str(300),
  highlights: { type: [String], default: [] }, amenities: { type: [String], default: [] },
  units: { type: [ppUnit], default: [] }, media: { type: [ppMedia], default: [] }, cover: str(24),
  published: { type: Boolean, default: false }, publishedAt: { type: Date, default: null },
  version: { type: Number, default: 1 }, createdBy: by, updatedBy: by,
}, opts).index({ developer: 1, name: 1 }));
// Project Pages settings, e.g. the inquiry form's endpoint (the Apps Script public hook that files Website Inquiries)
const ProjectSetting = mongoose.model('ProjectSetting', new Schema({ key: { type: String, required: true, unique: true, maxlength: 40 }, value: str(300), by }, opts));

// ---- Upselling (src/upsell.js): a draft offer, its audience filters, and one record per client it was sent to ----
const UP = require('../public/shared').UPSELL;
const UpsellCampaign = mongoose.model('UpsellCampaign', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  template: { type: String, default: 'concierge', maxlength: 30 },   // where the text started: 'concierge', a Services template key, or 'project'
  projectId: { type: String, default: '', maxlength: 24 },
  text: { type: String, default: '', maxlength: UP.textMax },
  image: { type: new Schema({ id: String, token: String, name: String, size: Number }, { _id: false }), default: null },   // token: the image's public link
  tag: { type: String, default: '', maxlength: 40 },
  channelId: { type: String, default: '', match: /^\d{0,20}$/ },   // respond.io channel for 1:1 sends ('' = Auto)
  audience: { type: new Schema({ preset: { type: String, enum: UP.presets, default: 'tenants' }, statuses: { type: [String], default: [] },
    type: { type: String, enum: ['', 'Rent', 'Buy'], default: '' }, city: str(60), contact: { type: String, enum: UP.contacts, default: 'respond' },
    skipDays: { type: Number, min: 0, max: 365, default: 14 } }, { _id: false }), default: () => ({}) },
  sendingUntil: { type: Date, default: null }, sendLock: { type: String, default: '' },   // a batch is running (one at a time per campaign)
  version: { type: Number, default: 1 }, createdBy: by, updatedBy: by,
}, opts));
// written before anything is sent (status 'sending'), then 'sent' / 'failed'; the unique index means a client can't get
// the same campaign twice, whatever the browser does. No message text, phone or email is stored here.
const UpsellSend = mongoose.model('UpsellSend', new Schema({
  campaignId: { type: ObjectId, ref: 'UpsellCampaign', required: true },
  source: { type: String, enum: ['monday', 'mongo'], required: true }, leadId: { type: String, required: true, maxlength: 40 },
  contactId: { type: String, default: '', maxlength: 20 },   // the respond.io contact: one send per contact, even if two leads share it
  action: { type: String, enum: ['message', 'tag'], required: true },
  status: { type: String, enum: ['sending', 'sent', 'failed'], required: true },
  steps: { type: new Schema({ image: Boolean, text: Boolean }, { _id: false }), default: () => ({}) },
  error: { type: String, default: '', maxlength: 300 }, attempts: { type: Number, default: 1 }, by,
}, opts).index({ campaignId: 1, leadId: 1, action: 1, source: 1 }, { unique: true }).index({ source: 1, leadId: 1, status: 1, updatedAt: -1 })
  .index({ campaignId: 1, contactId: 1, action: 1 }, { unique: true, partialFilterExpression: { contactId: { $gt: '' } } }));
// "never contact": set by staff (e.g. the client replied STOP); excluded from every audience and checked again on send
const UpsellOptOut = mongoose.model('UpsellOptOut', new Schema({ ...leadRef, by }, opts).index({ source: 1, leadId: 1 }, { unique: true }));

// ---- Upselling history from the Apps Script (scripts/import-legacy-upsell.js): its up_<lead> offers, so "skip if
// offered in the last N days" counts them. Its upo_<lead> opt-outs go to UpsellOptOut. ----
const UpsellLegacy = mongoose.model('UpsellLegacy', new Schema({
  source: { type: String, enum: ['monday'], default: 'monday' }, leadId: { type: String, required: true, index: true },
  at: { type: Date, required: true }, kind: { type: String, default: '', maxlength: 40 }, action: { type: String, default: 'message', maxlength: 20 },
}, opts).index({ source: 1, leadId: 1, at: 1, kind: 1, action: 1 }, { unique: true }));

// ---- Service Requests (src/services.js; Code.gs si_<lead> and the suppliers property) ----
const SVC = require('../public/shared').SERVICES;
const ServiceRequest = mongoose.model('ServiceRequest', new Schema({
  source: { type: String, enum: ['mongo', 'monday'], required: true }, leadId: { type: String, required: true, maxlength: 40 },
  svc: { type: String, enum: SVC.keys, required: true },
  interest: { type: String, enum: SVC.interests, default: 'no reply' },
  summary: { type: String, default: '', maxlength: 200 },
  details: { type: new Schema(Object.fromEntries(SVC.detailKeys.map((k) => [k, { type: String, default: '', maxlength: 200 }])), { _id: false }), default: () => ({}) },
  stage: { type: String, enum: SVC.stages, default: 'New' },
  supplierId: { type: String, default: '' }, supplierName: { type: String, default: '', maxlength: 80 },
  notes: { type: String, default: '', maxlength: 500 },
  offeredAt: { type: Date, default: null }, lastReply: { type: Date, default: null }, sentToSupplierAt: { type: Date, default: null }, scannedAt: { type: Date, default: null },
  history: { type: [new Schema({ at: Date, by: String, stage: String, what: String }, { _id: false })], default: [] },   // the last 20 kept
  version: { type: Number, default: 1 },
}, opts).index({ source: 1, leadId: 1, svc: 1 }, { unique: true }));
const Supplier = mongoose.model('Supplier', new Schema({
  svc: { type: String, enum: SVC.keys, required: true }, name: { type: String, required: true, maxlength: 80 },
  channel: { type: String, enum: SVC.channels, default: 'whatsapp' }, contact: { type: String, default: '', maxlength: 120 },
  respondId: { type: String, default: '', match: /^\d{0,20}$/ }, notes: { type: String, default: '', maxlength: 300 },
  updatedBy: { type: String, default: '' },
}, opts));
// a request sent to a supplier through respond.io: written before the send, then marked sent / failed / unknown
const ServiceSend = mongoose.model('ServiceSend', new Schema({
  requestId: { type: ObjectId, ref: 'ServiceRequest', required: true, index: true }, supplierId: { type: String, required: true },
  supplierName: { type: String, default: '' }, text: { type: String, default: '', maxlength: 4000 },
  status: { type: String, enum: ['sending', 'sent', 'failed', 'unknown'], default: 'sending' }, error: { type: String, default: '' },
  by: { type: String, default: '' },
  // "<requestId>:<supplierId>" while a send is in flight (removed when it ends): a double press can't send twice
  lock: { type: String, unique: true, sparse: true },
}, opts));

// ---- Deal files (src/deals.js; Code.gs vw_<lead>[listing].deal / .loi.clientSigned / .ownerSigned): per lead and unit ----
const dealFile = new Schema({ storage: { type: String, enum: ['drive'], default: 'drive' }, fileId: { type: String, required: true }, url: { type: String, default: '' },
  name: { type: String, default: '' }, type: { type: String, default: '' }, size: { type: Number, default: 0 }, src: { type: String, enum: ['upload', 'esign'], default: 'upload' },
  at: { type: Date, default: Date.now }, by: { type: String, default: '' } }, { _id: false });
const dealTermSchema = new Schema({ start: String, months: Number, end: String, renewFrom: String }, { _id: false });
const DealFile = mongoose.model('DealFile', new Schema({
  source: { type: String, enum: ['mongo', 'monday'], required: true }, leadId: { type: String, required: true, maxlength: 40 },
  unitKey: { type: String, required: true, maxlength: 40 },   // the portal viewing's listing, or the Monday Calendar item
  unitName: { type: String, default: '', maxlength: 160 },
  slots: { clientLoi: { type: dealFile, default: null }, ownerLoi: { type: dealFile, default: null }, contract: { type: dealFile, default: null }, deposit: { type: dealFile, default: null } },
  renewals: { type: [new Schema({ file: dealFile, term: dealTermSchema }, { _id: false })], default: [] },
  term: { type: dealTermSchema, default: null },
  history: { type: [new Schema({ at: Date, by: String, what: String }, { _id: false })], default: [] },
}, { ...opts, minimize: false }).index({ source: 1, leadId: 1, unitKey: 1 }, { unique: true }));

// ---- LOI (src/loi.js): the team's Word templates and the LOIs made from them for review (nothing is sent or signed) ----
const LOI_SLOT_KEYS = Object.keys(require('../public/shared').LOI_SLOTS);
const LoiTemplate = mongoose.model('LoiTemplate', new Schema({
  slot: { type: String, enum: LOI_SLOT_KEYS, required: true, unique: true },
  name: { type: String, default: '', maxlength: 200 }, size: { type: Number, default: 0 },
  data: { type: Buffer, required: true },   // the .docx (a few tens of KB)
  uploadedBy: { type: new Schema(person, { _id: false }), required: true },
}, opts));
const Loi = mongoose.model('Loi', new Schema({
  source: { type: String, enum: ['mongo', 'monday'], required: true }, leadId: { type: String, required: true, index: true },
  slot: { type: String, enum: LOI_SLOT_KEYS, required: true }, templateName: { type: String, default: '' }, templateAt: { type: Date, default: null },
  fields: { type: Schema.Types.Mixed, default: {} }, missing: { type: [String], default: [] },
  data: { type: Buffer, required: true },   // the filled .docx, for the team's review
  // the unit it's for (a Monday Calendar item, or the portal viewing's listing): signed copies go to its deal files
  unitKey: { type: String, default: '', maxlength: 40 }, unitName: { type: String, default: '', maxlength: 160 },
  // draft → sent (client link) → clientSigned → ownerSent → signed (both). Signing needs LOI_SIGNING=on (src/loiSign.js)
  status: { type: String, enum: ['draft', 'sent', 'clientSigned', 'ownerSent', 'signed'], default: 'draft' },
  signed: { type: new Schema({ client: { type: Schema.Types.Mixed, default: null }, owner: { type: Schema.Types.Mixed, default: null } }, { _id: false }), default: () => ({}) },
  signedData: { type: Buffer, default: null },   // the latest signed .docx
  pdf: { type: Buffer, default: null },          // the PDF the next signer reads (unsigned for the client, client-signed for the owner)
  createdBy: { type: new Schema(person, { _id: false }), required: true },
}, { ...opts, minimize: false }));
// a signing link: only the sha256 of its token is stored; it expires, works once, and a new link replaces the old one
const LoiSignLink = mongoose.model('LoiSignLink', new Schema({
  tokenHash: { type: String, required: true, unique: true }, loiId: { type: ObjectId, ref: 'Loi', required: true, index: true },
  role: { type: String, enum: ['client', 'owner'], required: true }, signerName: { type: String, default: '', maxlength: 120 },
  expiresAt: { type: Date, required: true }, usedAt: { type: Date, default: null }, revokedAt: { type: Date, default: null },
  claimUntil: { type: Date, default: null },   // being signed until then (a crash halfway leaves the link usable again)
  delivery: { channel: { type: String, enum: ['link', 'respond', 'email'], default: 'link' }, to: { type: String, default: '' }, status: { type: String, default: '' } },
  createdBy: { type: String, default: '' }, failedAttempts: { type: Number, default: 0 },
}, opts));

// ---- Google Drive storage in a My Drive (src/driveStore.js, GOOGLE_DRIVE_OAUTH=on): the one connected Google account ----
// The refresh token is AES-256-GCM encrypted with GOOGLE_DRIVE_TOKEN_KEY and never leaves the server (select: false).
const enc = { iv: String, tag: String, data: String };
const DriveConnection = mongoose.model('DriveConnection', new Schema({
  key: { type: String, required: true, unique: true, enum: ['writer'], default: 'writer' },
  email: str(120), sub: str(60), scope: str(400), clientId: str(200),   // clientId: the OAuth client that holds the grant
  refreshToken: { type: new Schema(enc, { _id: false }), select: false },
  folders: { root: str(100), loi: str(100), deals: str(100) },   // created by the portal (drive.file sees only these)
  connectedBy: by, connectedAt: { type: Date, default: null },
  lastOkAt: { type: Date, default: null }, problem: str(400),       // problem: e.g. the access was removed in Google
}, opts));

module.exports = { DriveConnection, UpsellLegacy, LoiSignLink, DealFile, ServiceRequest, Supplier, ServiceSend, LoiTemplate, Loi, Lead, Listing, Viewing, Note, User, Template, Session, OAuthState, AvailabilityRequest, LeadOverride, MondayWrite, ViewingResult, RenewalLog, DailyNote, PlCell, KpiFeedback, KpiAck, KpiSnapshot, Project, ProjectSetting, UpsellCampaign, UpsellSend, UpsellOptOut };

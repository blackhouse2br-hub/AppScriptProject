'use strict';
// MongoDB models for the records the preview screens use. Monday.com remains the source for live leads;
// these collections hold app-owned data now and an imported snapshot later (see the migration notes in README).
const mongoose = require('mongoose');
const { LISTS, AI_STAGES, TEMPS, ROLES, RESULT } = require('../public/shared');

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
}, { timestamps: true }));

// one Google sign-in attempt (10 minutes): state, PKCE verifier and nonce, bound to the browser that started it
const OAuthState = mongoose.model('OAuthState', new Schema({
  stateHash: { type: String, required: true, unique: true },
  browserHash: { type: String, required: true },
  verifier: { type: String, required: true },
  nonce: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
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

module.exports = { Lead, Listing, Viewing, Note, User, Template, Session, OAuthState, AvailabilityRequest, LeadOverride, MondayWrite, ViewingResult };

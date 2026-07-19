'use strict';
// Small synthetic fixture builders for the ShowConnect feeds.
// Shapes mirror the real payloads (EntryList[].RidingDetails[].Venues[],
// DivisionsList/ScoringList) but carry only the fields index.html reads.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');

// Feed "RideTimes" string, e.g. "Fri, Jul 17, 2026, 12:30:00 PM".
function rideTimeStr(y, m, d, h24, min, sec = 0) {
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const h12 = h24 % 12 || 12;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  return `${wd}, ${MONTHS[m - 1]} ${d}, ${y}, ${h12}:${pad(min)}:${pad(sec)} ${ampm}`;
}

// One RidingDetails item. `venueDate`/`venueTime` are the publish timestamp
// (deliberately NOT the ride time — see TESTPLAN A2).
function ridingDetail({ phase, venue = 'R1', time = '', venueDate = '2026-07-16', venueTime = '01:20:42.066' }) {
  return {
    Phase: phase,
    Venues: [{ venue, ordinal: '', date: venueDate, time: venueTime }],
    RideTimes: time,
  };
}

// One EntryList item. `details` is an array of ridingDetail() objects.
function entry({
  pinny, rider, horse = 'Test Horse', division = 'Test Division',
  divisionShort = 'TD', status = 'Accepted', details = [],
}) {
  return {
    EntryListId: 40000 + (pinny || 0),
    PinnyNumber: pinny,
    RiderName: rider,
    HorseName: horse,
    Status: status,
    Division: division,
    DivisionShortName: divisionShort,
    LevelType: 'ht',
    RidingDetails: details,
  };
}

function feed(entries = []) {
  return { EventDetails: { EventName: 'Test Event' }, EntryList: entries };
}

function division({ id, name }) {
  return { DivisionId: id, DivisionName: name, DivisionStatus: 'ACTIVE' };
}

// One ScoringList row. Feed uses "--" (or "") for not-posted values.
function scoringRow({
  pinny, divisionId, rider = 'Scoring Name (USA)', horse = 'H',
  dressageScore = '--', dressagePlace = '--',
  xcScore = '--', xcPlace = '--',
  sjScore = '--', sjPlace = '--',
  finalPoints = '--', finalPlace = '--',
}) {
  return {
    CRID: 30000 + (pinny || 0),
    DivisionId: divisionId,
    Pinny: pinny,
    HorseName: horse,
    RiderName: rider,
    DressageScore: dressageScore,
    DressagePlace: dressagePlace,
    XCScore: xcScore,
    XCPlace: xcPlace,
    SJScore: sjScore,
    SJPlace: sjPlace,
    FinalPoints: finalPoints,
    FinalPlace: finalPlace,
  };
}

function scoring({ divisions = [], rows = [] } = {}) {
  return { EventDetails: {}, DivisionsList: divisions, ScoringList: rows };
}

// Names from the page's baked-in FOLLOWING list, for fixtures that should
// be picked up without touching localStorage.
const FOLLOWED = {
  aulita: 'Aulita, Brittany',
  zook: 'Zook, Penelope',
  mcmahan: 'McMahan, Galena',
  corkery: 'Corkery, Maddie',
  grandia: 'Grandia, Marc',
  yakovac: 'Yakovac, Reese',
  braitling: 'Braitling, Rebecca',
  goodman: 'Goodman, Stephanie',
  crocker: 'Crocker, Shelby',
};
const FOLLOWING_COUNT = 9;

module.exports = {
  rideTimeStr, ridingDetail, entry, feed, division, scoringRow, scoring,
  FOLLOWED, FOLLOWING_COUNT,
};

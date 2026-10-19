'use strict';

// Support resources offered when someone may be in danger. Add an entry only
// after the team has verified it for the pilot's region (who it serves, how to
// reach it, opening hours) and record who checked it and when. Leave the list
// empty rather than guessing: an empty list shows general guidance only.
window.FFG_CARE_RESOURCES = Object.freeze({
  verifiedBy: '',
  verifiedAt: '',
  resources: Object.freeze([
    // Object.freeze({
    //   name: '', nameEn: '',
    //   contact: '', hours: '', hoursEn: '',
    //   note: '', noteEn: ''
    // })
  ])
});

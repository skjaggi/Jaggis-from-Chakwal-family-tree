// The family this backend serves, in one place (product plan phase 0; the
// browser side has the same values in site/js/family.js). Later each family's
// values will come from the database instead.
export const FAMILY = {
  site: 'https://familytree.sjaggi.com/',
  // Pages allowed to call the functions (the site, the old GitHub Pages
  // address and the local test server).
  origins: ['https://familytree.sjaggi.com', 'https://skjaggi.github.io', 'http://localhost:8765'],
  senderName: 'Jaggi family tree', // "From" name on emails
  footerName: 'Jaggis of Chakwal family tree', // email footer
  goatcounter: 'jaggis-chakwal', // visitor counter site code
};

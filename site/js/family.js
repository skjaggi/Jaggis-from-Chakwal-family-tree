// Everything that makes this site the Jaggi family's own, in one place, so
// the same code can serve other families later (docs/PRODUCT-REQUIREMENTS.md,
// phase 0). Changing a value here changes it everywhere on the site.
// Connection settings (Supabase, GoatCounter) stay in config.js.
export const family = {
  surname: 'Jaggi',
  familyName: 'Jaggi Family', // "Welcome dear member of Jaggi Family!"
  treeName: 'Jaggi family tree', // in email subjects
  peopleName: 'the Jaggis of Chakwal', // "the stories of the Jaggis of Chakwal"
  rootName: 'Bakhshi Bhanna Mal Jaggi',
  siteAddress: 'familytree.sjaggi.com',
  copyright: '© 2026 Jaggi Family and Quantum Nexus LLC. All rights reserved.',
  logo: {
    small: 'img/brand/jaggis-logo3-320.webp',
    large: 'img/brand/jaggis-logo3-800.webp',
    alt: 'Jaggis of Chakwal: Legacy, Family, Heritage',
  },
  companyMark: { src: 'img/brand/qn-mark-96.webp', alt: 'Quantum Nexus LLC logo' },
  gedcomSource: 'JAGGI_FAMILY_TREE',
  fileName: 'jaggi-family-tree',
  library: {
    blurb: 'Videos, articles and other writing about the Jaggis of Chakwal and the places our family comes from, collected by the family. ',
    menuTitle: 'Videos and articles about the family and Chakwal',
    topics: ['Chakwal history', 'Partition 1947', 'Arya High School', 'Family members', 'Places today', 'Other'],
    defaultTopic: 'Chakwal history',
    titleExample: 'e.g. Chakwal before Partition',
    // Words that suggest a topic for a new link, checked in this order.
    hints: [
      ['Partition 1947', 'partition|1947|refugee|riot|migrat|set (them|it) on fire'],
      ['Arya High School', 'arya|school|plaque|college|student|teacher'],
      ['Family members', 'jaggi|bakhshi|our family|grandfather|grandmother|dada|nana', { tagged: true }],
      ['Places today', 'village|today|visit|travel|tour|walk|drone|vahali|bhoun|dhudial|salt range'],
      ['Chakwal history', 'chakwal|history|gurdwara|temple|mandir|haveli|punjab|heritage|british|colonial|gazetteer'],
    ],
  },
  bookHeritageBlurb: 'Cream pages, deep green and gold, the banyan tree faintly behind. Made for the Jaggis of Chakwal coffee table book.',
};

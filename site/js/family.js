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
  // Branches start at this generation (each ancestor there heads a branch).
  // The database's privacy rules use the same number: public.branch_level().
  branchLevel: 4,
  // Special badges given by hand, not earned, each tied to one account and to
  // that person's own box in the tree. icon is one of the Blessings icons.
  specialBadges: [
    { id: 'founder', name: 'Founder of the Jaggi Family Tree', short: 'Founder', how: 'Had the idea and made the first family trees this one grew from', card: 'He had the idea for this family tree and made the first two family trees it grew from.', color: '#17706b', icon: 'seed',
      user: 'fb6fc331-a891-4756-8cfe-37a178b54fe4', person: '71296ea4-33fc-50e4-9924-8b156fdb27e9' }, // Suraj Parkash Jaggi
    { id: 'creator', name: 'Creator of the Jaggi Family Tree', short: 'Creator', how: 'Built this family tree, with the idea and blessing of the founder', card: 'He built this family tree, with the idea and blessing of the founder, Suraj Parkash Jaggi.', color: '#7a2e3a', icon: 'branch',
      user: '80115979-6027-4f4a-939e-7fbad4c489a2', person: '143f144c-493b-5c9f-9996-9f7de3feafcc' }, // Sunil Kumar Jaggi
  ],
  bookHeritageBlurb: 'Cream pages, deep green and gold, the banyan tree faintly behind. Made for the Jaggis of Chakwal coffee table book.',
};

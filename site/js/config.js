// Site settings. Fill in the two Supabase values from
// Supabase dashboard → Project Settings → API (see docs/SETUP.md).
// Both values are safe to publish: the "anon public" key only allows what the
// database's row level security rules allow.
//
// While these are empty the site runs in preview mode: it shows the starting
// tree from the family PDFs, read-only, with no sign-in.
export const config = {
  supabaseUrl: 'https://nxsaixeotbijfizievoq.supabase.co',
  supabaseAnonKey: 'sb_publishable_XML5JQRvgIV_WHdvn4CGTQ_jjgAlCyH',
  siteTitle: 'Jaggis of Chakwal',
  adminName: 'Sunil',
  // GoatCounter site code for the anonymous visitor counter ('' = off).
  goatcounter: '',
};

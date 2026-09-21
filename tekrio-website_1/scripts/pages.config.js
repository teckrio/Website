// Per-page metadata for the build script. Editing text/titles here does
// not require touching HTML — swap this for a real CMS later if needed.
const ORG_SCHEMA = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "TEKRIO",
  "url": "https://www.tekrio.in",
  "logo": "https://www.tekrio.in/images/logo.svg",
  "parentOrganization": {
    "@type": "Organization",
    "name": "Anabriya Technologies LLP"
  },
  "email": "support@tekrio.in",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Bengaluru",
    "addressRegion": "Karnataka",
    "addressCountry": "IN"
  }
}
</script>`;

module.exports = [
  {
    file: "home.html",
    out: "index.html",
    active: "home",
    title: "TEKRIO - Get Best Price For Your Old Phone | Used Phone Exchange Platform",
    description:
      "Sell your old phone for the best price. TEKRIO connects you with verified vendors via trusted retailers. Instant, transparent & best value for your old smartphone.",
    schema: ORG_SCHEMA,
  },
  {
    file: "about.html",
    out: "about.html",
    active: "",
    title: "About TEKRIO | Anabriya Technologies LLP",
    description:
      "TEKRIO is a 3-sided platform connecting customers, retailers and vendors so every old phone finds its fairest price. Learn who we are and why we built TEKRIO.",
  },
  {
    file: "how-it-works.html",
    out: "how-it-works.html",
    active: "how",
    title: "How TEKRIO Works - Visit, Compare, Close | TEKRIO",
    description:
      "See exactly how TEKRIO turns a store visit into your best possible phone exchange price in three simple, transparent steps.",
  },
  {
    file: "for-customers.html",
    out: "for-customers.html",
    active: "customers",
    title: "For Customers - Get The Best Price For Your Old Phone | TEKRIO",
    description:
      "Get the highest market value for your old phone. Multiple verified vendor offers, transparent pricing, instant payment and secure data wipe at a trusted TEKRIO retailer.",
  },
  {
    file: "for-retailers.html",
    out: "for-retailers.html",
    active: "retailers",
    title: "For Retailers - Earn More On Every Exchange | TEKRIO",
    description:
      "Register your mobile store on TEKRIO. Earn commission on every old phone, drive more footfall and new-phone sales, and list a device in 30 seconds via the TEKRIO app.",
  },
  {
    file: "for-vendors.html",
    out: "for-vendors.html",
    active: "vendors",
    title: "For Vendors - Verified Inventory, Pan-India Sourcing | TEKRIO",
    description:
      "Access genuine, graded used-phone inventory from a pan-India retail network. Get IMEI and photo-verified listings, cut sourcing cost and time, and buy in bulk.",
  },
  {
    file: "partner.html",
    out: "partner.html",
    active: "partner",
    title: "Become a Partner | TEKRIO Business Partnerships",
    description:
      "Partner with TEKRIO as a retailer, vendor, or business associate and grow with India's trusted phone exchange network.",
  },
  {
    file: "contact.html",
    out: "contact.html",
    active: "contact",
    title: "Contact Us | TEKRIO",
    description:
      "Get in touch with the TEKRIO team at Anabriya Technologies LLP. Based in Bengaluru, Karnataka. Email support@tekrio.in.",
  },
  {
    file: "faq.html",
    out: "faq.html",
    active: "",
    title: "Frequently Asked Questions | TEKRIO",
    description:
      "Answers for customers, retailers and vendors about how TEKRIO works, pricing, payments, verification and registration.",
  },
  {
    file: "privacy-terms.html",
    out: "privacy-terms.html",
    active: "",
    title: "Privacy Policy & Terms and Conditions | TEKRIO",
    description:
      "Read TEKRIO's Privacy Policy and Terms & Conditions, operated by Anabriya Technologies LLP.",
  },
  {
    file: "404.html",
    out: "404.html",
    active: "",
    title: "Page Not Found | TEKRIO",
    description: "The page you're looking for doesn't exist or may have moved.",
    noindex: true,
  },
];

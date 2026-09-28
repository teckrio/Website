// Per-page metadata for the build script. Editing text/titles here does
// not require touching HTML — swap this for a real CMS later if needed.
const ORG_SCHEMA = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "TEKRIO",
  "url": "https://www.tekrio.in",
  "logo": "https://www.tekrio.in/images/logo.png",
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
    title: "TEKRIO - Pre-Owned Device Marketplace | Sell Your Device",
    description:
      "Sell your pre-owned phone or device on TEKRIO. Get offers from verified buyers through trusted local retailers, compare them, and choose the one you want.",
    schema: ORG_SCHEMA,
  },
  {
    file: "about.html",
    out: "about.html",
    active: "",
    title: "About TEKRIO | Anabriya Technologies LLP",
    description:
      "TEKRIO is a pre-owned device marketplace connecting customers, retailers and buyers. Learn who we are and why we built TEKRIO.",
  },
  {
    file: "how-it-works.html",
    out: "how-it-works.html",
    active: "how",
    title: "How TEKRIO Works - Select, Add Details, Get Offers | TEKRIO",
    description:
      "Select your device, add details, get offers from verified buyers, choose an offer and complete the transaction - see how the TEKRIO marketplace works.",
  },
  {
    file: "sell.html",
    out: "sell.html",
    active: "sell",
    title: "Sell Your Device - Get Offers From Verified Buyers | TEKRIO",
    description:
      "Sell your pre-owned phone on TEKRIO. Select your device, add details, and get offers from verified buyers through a partnered retailer near you.",
  },
  {
    file: "for-customers.html",
    out: "for-customers.html",
    active: "customers",
    title: "For Customers - Sell Your Pre-Owned Device | TEKRIO",
    description:
      "Sell your pre-owned device with offers from multiple verified buyers. Compare offers, choose one, and complete the sale at a trusted TEKRIO retailer.",
  },
  {
    file: "for-retailers.html",
    out: "for-retailers.html",
    active: "retailers",
    title: "For Retailers - Earn More On Every Pre-Owned Device | TEKRIO",
    description:
      "Register your store on TEKRIO. Earn commission on every pre-owned device sold, bring in more customers, and let verified buyers make offers.",
  },
  {
    file: "for-buyers.html",
    out: "for-buyers.html",
    active: "buyers",
    title: "For Buyers - Source Inspected Pre-Owned Devices | TEKRIO",
    description:
      "Source inspected pre-owned devices from partnered retailers. IMEI and photo-documented listings in one marketplace feed, with less sourcing cost and time.",
  },
  {
    file: "partner.html",
    out: "partner.html",
    active: "partner",
    title: "Become a Partner | TEKRIO Business Partnerships",
    description:
      "Partner with TEKRIO as a retailer, buyer, or business associate and grow with the TEKRIO pre-owned device marketplace.",
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
      "Answers for customers, retailers and buyers about how TEKRIO works, offers, payments, verification and registration.",
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

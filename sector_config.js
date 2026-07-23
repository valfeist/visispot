/**
 * Search radii per business sector.
 * radius_primary   -> replaces the former "500m" radius
 * radius_secondary -> replaces the former "1km" radius
 *
 * Radii in meters. Tuned to the typical catchment area of each
 * sector (a bakery draws from a shorter distance than a wine shop).
 *
 * Note: the keys (e.g. "boulangerie") are the normalized sector
 * values coming from the order form, so they stay in French.
 */

// Must stay in sync with radius_primary / radius_secondary in
// sector-type-mapping.js. Existing sectors are unchanged.
const SECTOR_CONFIG = {
  // Restauration & café
  "restauration":         { radius_primary: 500,  radius_secondary: 700  },
  "snacking":             { radius_primary: 500,  radius_secondary: 700  },
  "cafe":                 { radius_primary: 400,  radius_secondary: 600  },
  // Commerce de bouche
  "boulangerie":          { radius_primary: 400,  radius_secondary: 600  },
  "boucherie":            { radius_primary: 500,  radius_secondary: 800  },
  "poissonnerie":         { radius_primary: 700,  radius_secondary: 1000 },
  "primeur":              { radius_primary: 500,  radius_secondary: 800  },
  "fromagerie":           { radius_primary: 700,  radius_secondary: 1000 },
  "epicerie_fine":        { radius_primary: 700,  radius_secondary: 1000 },
  "caviste":              { radius_primary: 700,  radius_secondary: 1000 },
  // Beauté & soin
  "coiffure":             { radius_primary: 600,  radius_secondary: 900  },
  "beaute":               { radius_primary: 600,  radius_secondary: 900  },
  // Services du quotidien
  "pressing":             { radius_primary: 600,  radius_secondary: 800  },
  "laverie":              { radius_primary: 400,  radius_secondary: 600  },
  "retouche":             { radius_primary: 600,  radius_secondary: 800  },
  "cordonnerie":          { radius_primary: 600,  radius_secondary: 800  },
  "fleuriste":            { radius_primary: 600,  radius_secondary: 900  },
};

module.exports = { SECTOR_CONFIG };

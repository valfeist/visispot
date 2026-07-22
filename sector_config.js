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

const SECTOR_CONFIG = {
  "boulangerie":          { radius_primary: 400,  radius_secondary: 600  },
  "restauration":         { radius_primary: 500,  radius_secondary: 700  },
  "snacking":             { radius_primary: 500,  radius_secondary: 700  },
  "coiffure":             { radius_primary: 600,  radius_secondary: 900  },
  "beaute":               { radius_primary: 600,  radius_secondary: 900  },
  "epicerie_fine":        { radius_primary: 700,  radius_secondary: 1000 },
  "caviste":              { radius_primary: 700,  radius_secondary: 1000 },
  "pressing":             { radius_primary: 600,  radius_secondary: 800  },
  "laverie":              { radius_primary: 400,  radius_secondary: 600  },
  "retouche":             { radius_primary: 600,  radius_secondary: 800  },
};

module.exports = { SECTOR_CONFIG };

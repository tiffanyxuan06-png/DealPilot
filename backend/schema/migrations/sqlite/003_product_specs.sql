-- 003: Product specifications and catalog knowledge for AI sales recommendations
ALTER TABLE products ADD COLUMN specs_json TEXT NOT NULL DEFAULT '{}';

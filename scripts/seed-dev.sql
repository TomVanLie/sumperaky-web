-- Ukázková data jen pro lokální vývoj (npm run db:seed:local). Na produkci nespouštět.
INSERT INTO houses (id, status, lat, lng, country, street, house_number, municipality, municipality_slug, district, region, state, year_built, year_renovated, roof, facade_color, note, approved_at)
VALUES
  (1, 'approved', 49.9681, 16.9612, 'cz', 'Ukázková', '1', 'Šumperk', 'sumperk', 'okres Šumperk', 'Olomoucký kraj', 'original', 1978, NULL, 'eternit', 'beige', 'Ukázkový záznam pro vývoj.', datetime('now')),
  (2, 'approved', 49.9702, 16.9655, 'cz', 'Ukázková', '2', 'Šumperk', 'sumperk', 'okres Šumperk', 'Olomoucký kraj', 'renovated', 1981, 2019, 'tiles', 'white', 'Ukázkový záznam pro vývoj.', datetime('now')),
  (3, 'approved', 49.5938, 17.2509, 'cz', 'Ukázková', '3', 'Olomouc', 'olomouc', 'okres Olomouc', 'Olomoucký kraj', 'partial', 1983, NULL, 'metal', 'yellow', NULL, datetime('now')),
  (4, 'approved', 48.7164, 21.2611, 'sk', 'Ukážková', '4', 'Košice', 'kosice', 'okres Košice', 'Košický kraj', 'in_progress', 1979, 2026, NULL, 'light_gray', NULL, datetime('now')),
  (5, 'pending', 49.9690, 16.9700, 'cz', 'Ukázková', '5', 'Šumperk', 'sumperk', 'okres Šumperk', 'Olomoucký kraj', 'unknown', NULL, NULL, NULL, NULL, 'Čeká na schválení.', NULL);

INSERT INTO house_modifications (house_id, modification) VALUES
  (2, 'both_floors_living'), (2, 'insulation'), (2, 'windows'), (2, 'solar'),
  (4, 'insulation'), (4, 'dormers');

UPDATE houses SET design = 'atypical' WHERE id = 3;

INSERT INTO revisions (house_id, summary) VALUES (1, 'Dům přidán'), (2, 'Dům přidán'), (3, 'Dům přidán'), (4, 'Dům přidán');

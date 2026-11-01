-- Další znaky domu: 1 = ano, 0 = ne, NULL = nevím.
ALTER TABLE houses ADD COLUMN shutters INTEGER CHECK (shutters IN (0, 1));
ALTER TABLE houses ADD COLUMN garage_integrated INTEGER CHECK (garage_integrated IN (0, 1));
ALTER TABLE houses ADD COLUMN original_terrace INTEGER CHECK (original_terrace IN (0, 1));

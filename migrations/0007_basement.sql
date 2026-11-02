-- Podsklepení: 1 = ano, 0 = ne, NULL = nevím.
ALTER TABLE houses ADD COLUMN basement INTEGER CHECK (basement IN (0, 1));

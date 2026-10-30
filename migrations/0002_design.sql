-- Typ návrhu: blízký původnímu návrhu (Vaněk), nebo atypicky upravený.
ALTER TABLE houses ADD COLUMN design TEXT NOT NULL DEFAULT 'original' CHECK (design IN ('original', 'atypical'));

-- Dřív se to zadávalo mezi úpravami, převedeme to do nového pole.
UPDATE houses SET design = 'atypical'
 WHERE id IN (SELECT house_id FROM house_modifications WHERE modification = 'modified_design');
DELETE FROM house_modifications WHERE modification IN ('original_design', 'modified_design');

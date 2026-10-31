-- Místo, odkud se na dům díváme v panoramatu. Rohové domy jinak bývají vidět z boční ulice.
ALTER TABLE houses ADD COLUMN cam_lat REAL;
ALTER TABLE houses ADD COLUMN cam_lng REAL;

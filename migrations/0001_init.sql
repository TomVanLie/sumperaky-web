-- Šumperáky: základní schéma

CREATE TABLE houses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden', 'rejected')),
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  country         TEXT NOT NULL DEFAULT 'cz' CHECK (country IN ('cz', 'sk')),
  street          TEXT,
  house_number    TEXT,
  -- Majitel nebo přispěvatel může skrýt číslo domu, zobrazí se jen ulice a obec.
  hide_number     INTEGER NOT NULL DEFAULT 0,
  municipality    TEXT NOT NULL,
  municipality_slug TEXT NOT NULL,
  district        TEXT,
  region          TEXT,
  state           TEXT NOT NULL,
  roof            TEXT,
  facade_color    TEXT,
  year_built      INTEGER,
  year_renovated  INTEGER,
  note            TEXT,
  link            TEXT,
  -- Street View: NULL heading znamená automatické natočení na dům.
  sv_heading      REAL,
  sv_pitch        REAL,
  submitter_hash  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at     TEXT
);

CREATE INDEX idx_houses_status ON houses (status);
CREATE INDEX idx_houses_geo ON houses (lat, lng);
CREATE INDEX idx_houses_municipality ON houses (municipality_slug);

CREATE TABLE house_modifications (
  house_id     INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  modification TEXT NOT NULL,
  PRIMARY KEY (house_id, modification)
);

CREATE INDEX idx_mods_modification ON house_modifications (modification);

CREATE TABLE photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id     INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL UNIQUE,
  phase        TEXT NOT NULL CHECK (phase IN ('before', 'during', 'after', 'current')),
  year_taken   INTEGER,
  caption      TEXT,
  author       TEXT,
  width        INTEGER,
  height       INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitter_hash TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_photos_house ON photos (house_id, status);
CREATE INDEX idx_photos_status ON photos (status);

-- Komunitní potvrzení "ano, je to šumperák". Jedno na dům a zařízení.
CREATE TABLE confirmations (
  house_id     INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  voter_hash   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (house_id, voter_hash)
);

-- Návrhy úprav od veřejnosti, čekají na schválení moderátorem.
CREATE TABLE edit_suggestions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id     INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  payload      TEXT NOT NULL,
  comment      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  submitter_hash TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT
);

CREATE INDEX idx_edits_status ON edit_suggestions (status);

-- Nahlášení: chyba, duplicita, není šumperák, žádost majitele o skrytí.
CREATE TABLE reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id     INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('wrong', 'duplicate', 'not_sumperak', 'owner_removal', 'other')),
  message      TEXT,
  contact      TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  submitter_hash TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT
);

CREATE INDEX idx_reports_status ON reports (status);

-- Historie změn veřejně viditelná v detailu domu.
CREATE TABLE revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id     INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  summary      TEXT NOT NULL,
  changes      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_revisions_house ON revisions (house_id);

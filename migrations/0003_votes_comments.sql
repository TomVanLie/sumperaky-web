-- Hlasování "je to šumperák?" ano/ne. Jeden hlas na dům a zařízení, jde změnit.
CREATE TABLE votes (
  house_id     INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  voter_hash   TEXT NOT NULL,
  vote         INTEGER NOT NULL CHECK (vote IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (house_id, voter_hash)
);

CREATE INDEX idx_votes_updated ON votes (voter_hash, updated_at);

-- Dosavadní potvrzení jsou hlasy "ano".
INSERT INTO votes (house_id, voter_hash, vote, created_at, updated_at)
  SELECT house_id, voter_hash, 1, created_at, created_at FROM confirmations;
DROP TABLE confirmations;

-- Anonymní komentáře. Text bez odkazů se zobrazí hned, s odkazem čeká na moderátora.
CREATE TABLE comments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id       INTEGER NOT NULL REFERENCES houses (id) ON DELETE CASCADE,
  nickname       TEXT,
  body           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'pending', 'hidden')),
  submitter_hash TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_house ON comments (house_id, status);
CREATE INDEX idx_comments_status ON comments (status);
CREATE INDEX idx_comments_submitter ON comments (submitter_hash, created_at);

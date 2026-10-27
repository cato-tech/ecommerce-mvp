-- Membership: mỗi hạng có một mức score; discount ở Order Service dựa trên score này
CREATE TABLE IF NOT EXISTS memberships (
  mid   SERIAL PRIMARY KEY,
  mname VARCHAR(50) UNIQUE NOT NULL,
  score INT NOT NULL CHECK (score >= 0)
);

INSERT INTO memberships (mname, score) VALUES ('BRONZE', 0), ('SILVER', 100), ('GOLD', 500)
ON CONFLICT (mname) DO NOTHING;

-- uid tham chiếu sang Auth Service (khác database nên KHÔNG có FOREIGN KEY)
CREATE TABLE IF NOT EXISTS customers (
  uid        INT PRIMARY KEY,
  fullname   VARCHAR(100) NOT NULL,
  mid        INT NOT NULL REFERENCES memberships (mid),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

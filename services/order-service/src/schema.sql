-- oid bắt đầu từ 1001 cho giống ví dụ trong API Spec
CREATE TABLE IF NOT EXISTS orders (
  oid        INT GENERATED ALWAYS AS IDENTITY (START WITH 1001) PRIMARY KEY,
  uid        INT NOT NULL,                       -- tham chiếu Auth/Customer, khác database nên không có FK
  discount   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= 100), -- phần trăm
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_uid ON orders (uid);

CREATE TABLE IF NOT EXISTS order_details (
  oid        INT NOT NULL REFERENCES orders (oid) ON DELETE CASCADE,
  pid        INT NOT NULL,
  qty        INT NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0), -- giá tại thời điểm đặt
  PRIMARY KEY (oid, pid)
);

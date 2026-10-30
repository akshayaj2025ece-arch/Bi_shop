-- ====================================================================
-- BISHOP: Production Security Hardening & Data Integrity Migration
-- Safe, additive, non-destructive migration script.
-- Execute in Supabase SQL Editor to tighten RLS and add performance indexes.
-- ====================================================================

-- 1. Ensure all schema columns exist with sensible defaults
ALTER TABLE shops ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS upi_id TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS payment_qr_url TEXT;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE SET NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'pay_at_counter';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_pre_order BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS grand_total NUMERIC(10,2) DEFAULT 0;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Durable Idempotency Storage for Critical Operations
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  response JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_idempotency_scope_key UNIQUE (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Idempotency table is managed strictly server-side by service_role key
DROP POLICY IF EXISTS "Deny all public access to idempotency" ON idempotency_keys;
CREATE POLICY "Deny all public access to idempotency"
  ON idempotency_keys FOR ALL
  TO public
  USING (false);

-- 3. Non-recursive security definer helper
CREATE OR REPLACE FUNCTION get_user_shop_id(user_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shop_id FROM profiles WHERE id = user_id LIMIT 1;
$$;

-- 4. Secure RLS for Orders: Block anonymous users from forging 'paid' status
DROP POLICY IF EXISTS "Anyone can create orders" ON orders;
CREATE POLICY "Customers can create pending orders"
  ON orders FOR INSERT
  WITH CHECK (
    -- Public takeaway orders can only be inserted in 'pending' payment status
    -- Marking an order as 'paid' is strictly reserved for verified payment callbacks via service role
    payment_status IN ('pending', 'pay_at_counter')
  );

-- 5. Tighten Inventory & Menu Items RLS
-- Block unauthenticated public users from directly updating stock or menu availability
DROP POLICY IF EXISTS "Public cannot modify inventory" ON inventory;
DROP POLICY IF EXISTS "Public cannot modify menu_items" ON menu_items;

-- 6. Performance Indexes for Query Optimization
CREATE INDEX IF NOT EXISTS idx_orders_shop_status ON orders(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_shop_name_lower ON inventory(shop_id, lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_menu_items_shop_active ON menu_items(shop_id, is_available);
CREATE INDEX IF NOT EXISTS idx_employees_shop_profile ON employees(shop_id, profile_id);

-- 7. Durable OTP and Password Reset Token Storage for Serverless Production
CREATE TABLE IF NOT EXISTS auth_otps (
  email TEXT PRIMARY KEY,
  otp_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  reset_token_hash TEXT,
  reset_token_expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_otps_expires ON auth_otps(expires_at);

ALTER TABLE auth_otps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access to auth_otps" ON auth_otps;
CREATE POLICY "Deny all public access to auth_otps"
  ON auth_otps FOR ALL
  TO public
  USING (false);

-- 8. Distributed Rate Limiter Storage for Serverless Instances
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access to rate_limits" ON rate_limits;
CREATE POLICY "Deny all public access to rate_limits"
  ON rate_limits FOR ALL
  TO public
  USING (false);

-- 9. Atomic Inventory Stock Decrement Function to Prevent Race Conditions & Reject Insufficient Stock
CREATE OR REPLACE FUNCTION decrement_inventory_stock(
  p_shop_id UUID,
  p_menu_item_id UUID,
  p_item_name TEXT,
  p_quantity INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id UUID;
  v_current_qty INT;
  v_new_qty INT;
BEGIN
  -- Validate input parameters
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_quantity',
      'error', 'Quantity must be a positive integer.'
    );
  END IF;

  -- Row-level lock via SELECT FOR UPDATE to serialize concurrent decrements
  SELECT id, quantity INTO v_inv_id, v_current_qty
  FROM inventory
  WHERE shop_id = p_shop_id AND lower(trim(name)) = lower(trim(p_item_name))
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'item_not_found',
      'error', 'Inventory item not found for shop.'
    );
  END IF;

  -- Reject insufficient stock deductions
  IF v_current_qty < p_quantity THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_stock',
      'error', 'Insufficient stock available.',
      'available_quantity', v_current_qty,
      'requested_quantity', p_quantity
    );
  END IF;

  v_new_qty := v_current_qty - p_quantity;

  UPDATE inventory
  SET quantity = v_new_qty, updated_at = now()
  WHERE id = v_inv_id;

  IF v_new_qty = 0 AND p_menu_item_id IS NOT NULL THEN
    UPDATE menu_items
    SET is_available = false, updated_at = now()
    WHERE id = p_menu_item_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inventory_id', v_inv_id,
    'previous_quantity', v_current_qty,
    'remaining_quantity', v_new_qty
  );
END;
$$;

-- Symmetrical stock compensation / rollback function
CREATE OR REPLACE FUNCTION increment_inventory_stock(
  p_shop_id UUID,
  p_menu_item_id UUID,
  p_item_name TEXT,
  p_quantity INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id UUID;
  v_current_qty INT;
  v_new_qty INT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_quantity');
  END IF;

  SELECT id, quantity INTO v_inv_id, v_current_qty
  FROM inventory
  WHERE shop_id = p_shop_id AND lower(trim(name)) = lower(trim(p_item_name))
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'item_not_found');
  END IF;

  v_new_qty := v_current_qty + p_quantity;

  UPDATE inventory
  SET quantity = v_new_qty, updated_at = now()
  WHERE id = v_inv_id;

  IF v_new_qty > 0 AND p_menu_item_id IS NOT NULL THEN
    UPDATE menu_items
    SET is_available = true, updated_at = now()
    WHERE id = p_menu_item_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inventory_id', v_inv_id,
    'previous_quantity', v_current_qty,
    'remaining_quantity', v_new_qty
  );
END;
$$;

-- 10. Secure Inventory RPC Permissions: Revoke public execution, restrict strictly to service_role
REVOKE EXECUTE ON FUNCTION decrement_inventory_stock(UUID, UUID, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION decrement_inventory_stock(UUID, UUID, TEXT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION decrement_inventory_stock(UUID, UUID, TEXT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION decrement_inventory_stock(UUID, UUID, TEXT, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION increment_inventory_stock(UUID, UUID, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_inventory_stock(UUID, UUID, TEXT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION increment_inventory_stock(UUID, UUID, TEXT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_inventory_stock(UUID, UUID, TEXT, INT) TO service_role;

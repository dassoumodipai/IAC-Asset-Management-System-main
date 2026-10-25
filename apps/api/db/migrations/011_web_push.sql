BEGIN;

CREATE TABLE web_push_subscriptions (
  endpoint_hash text PRIMARY KEY CHECK (endpoint_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX web_push_subscriptions_user_idx ON web_push_subscriptions(user_id);

COMMIT;

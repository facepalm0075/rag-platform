BEGIN;

-- Remove the existing role constraint
ALTER TABLE messages
DROP CONSTRAINT IF EXISTS messages_role_check;

-- Add the updated constraint
ALTER TABLE messages
ADD CONSTRAINT messages_role_check
CHECK (role IN ('user', 'assistant', 'system'));

COMMIT;
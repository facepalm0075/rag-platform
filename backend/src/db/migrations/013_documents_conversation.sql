ALTER TABLE documents ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;

DELETE FROM documents WHERE conversation_id IS NULL;

CREATE INDEX idx_documents_conversation_id ON documents(conversation_id);
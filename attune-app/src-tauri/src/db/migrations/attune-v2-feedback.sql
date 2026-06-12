-- Extended attention samples for feedback engine + emotion
ALTER TABLE attention_samples ADD COLUMN smoothed_score REAL;
ALTER TABLE attention_samples ADD COLUMN effective_score REAL;
ALTER TABLE attention_samples ADD COLUMN opacity REAL;
ALTER TABLE attention_samples ADD COLUMN feedback_state TEXT;
ALTER TABLE attention_samples ADD COLUMN emotion TEXT;

INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('feedback_profile', 'gentle');

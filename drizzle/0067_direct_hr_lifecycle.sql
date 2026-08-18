ALTER TABLE hr_offer_requests ADD COLUMN position TEXT NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE hr_offer_requests ADD COLUMN job_title TEXT NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE hr_offer_requests ADD COLUMN cancellation_reason TEXT NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE hr_offer_requests ADD COLUMN cancelled_by TEXT NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE hr_offer_requests ADD COLUMN cancelled_at INTEGER;--> statement-breakpoint
ALTER TABLE hr_offer_requests ADD COLUMN onboarded_by TEXT NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE hr_offer_requests ADD COLUMN onboarded_at INTEGER;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_hr_offer_onboarding_status_start
ON hr_offer_requests(status, start_date)
WHERE status IN ('ACCEPTED', 'ONBOARDED');--> statement-breakpoint
PRAGMA optimize;--> statement-breakpoint

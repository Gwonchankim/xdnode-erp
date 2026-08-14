ALTER TABLE `finance_cash_forecast_settings` ADD COLUMN `risk_policy_configured` integer DEFAULT 0 NOT NULL;
ALTER TABLE `finance_cash_forecast_settings` ADD COLUMN `risk_policy_version` integer DEFAULT 1 NOT NULL;
ALTER TABLE `finance_cash_forecast_settings` ADD COLUMN `minimum_debt_coverage_bps` integer DEFAULT 12500 NOT NULL;
ALTER TABLE `finance_cash_forecast_settings` ADD COLUMN `maximum_fx_concentration_bps` integer DEFAULT 5000 NOT NULL;
ALTER TABLE `finance_cash_forecast_settings` ADD COLUMN `warning_drawdown_bps` integer DEFAULT 2000 NOT NULL;
ALTER TABLE `finance_cash_forecast_settings` ADD COLUMN `critical_drawdown_bps` integer DEFAULT 3500 NOT NULL;
ALTER TABLE `finance_cash_forecast_settings` ADD COLUMN `low_balance_threshold` integer DEFAULT 100000 NOT NULL;
